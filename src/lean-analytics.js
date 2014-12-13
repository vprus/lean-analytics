(function(root, factory) {
  
    if (typeof define === 'function' && define.amd) {
        // AMD case: not actually tested yet.
        define(['exports', 'underscore', 'backbone', 'jquery', 'moment', 'crossfilter', 'dc.js', 'regression', 'unrolled-pie-chart'], function(exports, _, Backbone, $, moment, crossfilter, dc, regression, upc) {
            factory(root, exports, _, Backbone, $, moment, crossfilter, dc, regression, upc.unrolledPieChart);
        });
    }
    else if (typeof exports !== 'undefined') {
        // Node.js/CommonJS/browserify.
        var _ = require('underscore');
        var Backbone = require('backbone');
        var $ = require('jquery');
        var moment = require('moment');
        var crossfilter = require('crossfilter').crossfilter;
        var dc = require('dc.js');
        var regression = require('regression-js');
        var upc = require('./unrolled-pie-chart.js').unrolledPieChart;

        // Bootstrap JS uses window globals no matter what, so expose
        // JQuery
        window.$ = window.jQuery = $
        require('bootstrap');

        factory(root, exports, _, Backbone, $, moment, crossfilter, dc, regression, upc);
    } else {
        // Browser global
        root.LeanAnalytics = factory(root, {}, root._, root.Backbone, root.$, root.moment, root.crossfilter, root.dc, root.regression, root.dc.unrolledPieChart);
    }

})(this, function(root, LA, _, Backbone, $, moment, crossfilter, dc, regression, unrolledPieChart) {

    var Base = function() {}
    _.extend(Base.prototype, Backbone.Events);
    // Reuse Backbone's extend method, since we know it's rather generic.
    Base.extend = Backbone.Model.extend;

    LA.Model = Base.extend({

        constructor: function(_) {
            this.percentage = 0;

            if (arguments.length != 0) {
                this.percentage = 100;
                initialize(arguments[0]);
                model.dataReady_ = true;
                model.trigger("changed:state");
            }
        },

        // Load JSON resource with the specified URL.
        load: function(json) {
            var model = this;
            d3.json(json)
            .on("progress", function() {
                console.log("Progress " + d3.event.loaded + " of " + d3.event.total);
                if (d3.event.total)
                    model.percentage = Math.floor(100*d3.event.loaded/d3.event.total);
                else
                    model.percentage = 75;

                model.trigger("changed:state");
            })
            .on("load", function(json) { 
                model.percentage = 100;
                model.trigger("changed:state");
                model.initialize(json); 
                model.dataReady_ = true;
                model.trigger("changed:state");
            })
            .on("error", function(error) { 
                model.errorMessage = error; 
            })
            .get();
        },

        dataReady: function() {
            return this.dataReady_;
        },

        loadedPercentage: function() {
            return this.percentage;
        },

        // Called when the data is specified or loaded. 
        prepareData: function(data) {

            data.forEach(function(d) {
                d.t = new Date(d.t);
            });

        },

        initialize: function(data) {

            this.prepareData(data);

            this.data_ = data;
            this.crf = crossfilter(data);
            this.timeDimension = this.crf.dimension(function(d) { return d.t; });

            // FIXME: abstract away d.name
            this.entriesByName = this.crf.dimension(function(d) { return d.name; });
            this.entriesByNameGroup = this.entriesByName.group();

            this.ranges_ = this.makeRanges_();
        
            this.initializeData_();

            this.metrics_ = this.makeMainMetrics_();
            this.derivedMetrics_ = this.makeDerivedMetrics_();

            // Now try to apply reasonable defaults.
            this.range(this.ranges_[1].range);
            this.mainMetric(this.mainMetrics()[0]);
            this.derivedMetric(this.derivedMetrics()[0]);            
        },

        // Return the timestamp of a data entry. Default implementation returns
        // the 't' field.
        entryTime_: function(entry) {
            return entry.t;
        },

        // Returns the data to chart. Returned value is
        // an array, each element corresponding to chart.
        // First element will be drawn using large bar/line chart,
        // other elements will be drawn using smaller row charts.
        // Each top-level element is in turn an array describing
        // data to show. Presently, the first element must be
        // array of 2 elements, and other elements must be array of
        // a single element.
        // Each element should have these fields:
        // name, dimension, group, valueAccessor.
        graphData: function() {
            return this.graphData_;
        },

        range: function(range) {
            if (!arguments.length) return this.range_;
            this.range_ = range;
            this.timeDimension.filterRange(range);      
            return this;
        },

        ranges: function() {
            return this.ranges_;
        },

        makeRanges_: function() {

            var first = this.timeDimension.bottom(1)[0].t;

            return [
                {name: "All time", range: [new Date(first), new Date()]},
                {name: "2 years", range: this.computeRange(2, 'year')},
                {name: "1 year", range: this.computeRange(1, 'year')}
            ];
        },

        /** Return an array of possible data groups that can be used
            as main metric. Each returned object has:
            - 'name' attribute - the name to display in selector
            - 'group' attribute - the crossfilter group, only the 'all' method
            is used
            - 'valueAccessor' attribute - optional, a function to obtian the
            value from a group object. */
        mainMetrics: function() {
            return this.metrics_;        
        },

        mainMetric: function(metric) {
            if (!arguments.length) return this.mainMetric_;

            if (this.metrics_.indexOf(metric) == -1)
                throw "Invalid main metric";

            if (this.mainMetric_ === metric)
                return;

            this.entriesByNameGroup.reduce(metric.reduceAdd, metric.reduceRemove, metric.reduceInitial);
            this.entriesByNameGroup.order(function(v) { 
                return metric.valueAccessor({value: v});
            });

            this.graphData_.forEach(function(gd, i) {
                // We intentionally don't change gd[1], it should have the name of derived metric,
                // not the main one.
                gd[0].metricName = metric.name;
                gd[0].group.reduce(metric.reduceAdd, metric.reduceRemove, metric.reduceInitial);
                gd[0].valueAccessor = metric.valueAccessor;
                gd[0].group.order(function(v) { 
                    return metric.valueAccessor({value: v}); 
                });
            });

            this.mainMetric_ = metric;
            this.trigger('change:mainMetric', this);

            return this;
        },

        topEntries: function(k) {
            var r = this.entriesByNameGroup.top(k);
            var va = this.mainMetric_.valueAccessor;
            // crossfilter removes elements from groups when filtering, but does not remove
            // the grops. Further, with floating point filtering out can result in value close
            // to zero, but not quite zero. Filter out such useless groups.
            return r.filter(function(d) { return Math.abs(va(d)) > 0.00001; });
        },

        derivedMetric: function(metric) {
            if (!arguments.length) return this.derivedMetric_;

            if (this.derivedMetrics_.indexOf(metric) == -1)
                throw "Invalid derived metric";

            if (this.derivedMetric_ == metric)
                return;

            var d = this.graphData_[0][1];
            d.metricName = metric.name;
            d.group = metric.group;
            d.valueAccessor = metric.valueAccessor;

            this.derivedMetric_ = metric;
            this.trigger('change:derivedMetric', this);

            return this;
        },

        derivedMetrics: function() {
            return this.derivedMetrics_;
        },


        initializeData_: function() {
            var graphData_ = [[null, null]];


            var valueByTimeUnit = this.crf.dimension(function(d) { 
                return moment(d.t).startOf('isoWeek').toDate(); 
            });        
            var group = valueByTimeUnit.group();

            // Name, value accessor and reduce functions will come from metric.
            // FIXME: use 'groupName' everywhere else.
            graphData_[0][0] = {groupName: "week", dimension: valueByTimeUnit, group: group};
            // Pretty much everything comes from metric - including group that
            // will post-process values from graphData_[0][0]
            graphData_[0][1] = {dimension: valueByTimeUnit};

            this.makeAdditionalGroups_().forEach(function(g) {
                graphData_.push([g]);
            });

            this.graphData_ = graphData_;
            
        },

        makeMainMetrics_: function() {

            function reduceInitial() {
                return {
                    count: 0,
                    value: 0
                }
            };

            function reduceAdd(p, v) {
                p.count += 1;
                p.value += v.value;                
                return p;
            }

            function reduceRemove(p, v) {
                p.count -= 1;
                p.value -= v.value;
                return p;
            }

            return [
                {
                    name: "Value", 
                    reduceAdd: reduceAdd, reduceRemove: reduceRemove, reduceInitial: reduceInitial,
                    valueAccessor: function(d) { return d.value.value; }
                },                
                {
                    name: "Count", 
                    reduceAdd: reduceAdd, reduceRemove: reduceRemove, reduceInitial: reduceInitial,
                    valueAccessor: function(d) { return d.value.count; }
                }
            ]
        },

        // Create a Crossfilter group that takes currently selected metric,
        // and returns result of running it via the passed processor function.
        // The function will be passed an array of [time, value] arrays that
        // it is free to modify in-place or process.
        makeDerivedMetricGroup_: function(processor) {

            var model = this;

            return {
                all: function() {

                    var metric = model.graphData()[0][0];
                    
                    var raw = [];
                    metric.group.all().forEach(function (d) {
                        if (d.key.getTime() >= model.range()[0].getTime())
                            raw.push([d.key, metric.valueAccessor(d)]);
                    });

                    return processor(raw).map(function(d) { return {key: d[0], value: d[1]}; });
                }
            }
        },



        makeDerivedMetrics_: function() {

            var model = this;

            var regression_group = this.makeDerivedMetricGroup_(function(data) {
                data.forEach(function(d) { d[0] = d[0].getTime(); });
                return regression('linear', data).points.map(function(d) {
                    return [new Date(d[0]), d[1]];
                });
            });

            var cumulative_group = this.makeDerivedMetricGroup_(function(data) {
                var total = 0;
                data.forEach(function(d) {
                    total += d[1];
                    d[1] = total
                });
                return data;    
            });

            var average_group = this.makeDerivedMetricGroup_(function(data) {
                var win = 4;

                for (i = data.length - 1; i - win + 1 >= 0; --i) {
                    var sum = 0.0;
                    var j;
                    for (j = 0; j < win; ++j)
                        sum += data[i - j][1];
                    data[i][1] = sum/win;
                }

                return data;
            });

            var smooth_group = {
                all: function() {

                    var metric = model.graphData()[0][0];
                    
                    var raw = [];
                    metric.group.all().forEach(function (d) {
                        if (d.key.getTime() >= model.range()[0].getTime())
                            raw.push([d.key.getTime(), metric.valueAccessor(d)]);
                    });
                    
                    // JavaScript code from http://bl.ocks.org/bycoffe/1207194
                    // Adapted from http://www.swharden.com/blog/2008-11-17-linear-data-smoothing-in-python/
                    var smooth = function (list, degree) {
                        var win = degree*2-1;
                        weight = _.range(0, win).map(function (x) { return 1.0; });
                        weightGauss = [];
                        for (i in _.range(0, win)) {
                            i = i-degree+1;
                            frac = i/win;
                            gauss = 1 / Math.exp((4*(frac))*(4*(frac)));
                            weightGauss.push(gauss);
                        }
                        weight = _(weightGauss).zip(weight).map(function (x) { return x[0]*x[1]; });
                        smoothed = _.range(0, (list.length+1)-win).map(function (x) { return 0.0; });
                        for (i=0; i < smoothed.length; i++) {
                            smoothed[i] = _(list.slice(i, i+win)).zip(weight).map(function (x) { return x[0]*x[1]; }).reduce(function (memo, num){ return memo + num; }, 0) / _(weight).reduce(function (memo, num){ return memo + num; }, 0);
                        }
                        return smoothed;
                    }

                    var raw2 = raw.map(function(d) { return d[1]; });
                    raw2 = smooth(raw2, 4);

                    var i;
                    var result = []
                    for (i = 0; i < raw2.length; ++i) {
                        result.push({key: raw[i + 5][0], value: raw2[i]});
                    }
                    
                    return result;
                }
            };

            return [
                {name: "Linear regression", group: regression_group},
                {name: "Cumulative", group: cumulative_group},
                {name: "Smooth - 4-week average", group: average_group},
                {name: "Smooth - 7-week gaussian", group: smooth_group}
            ]
        },

        makePerDayOfWeekGroup_: function() {

            var perDayOfWeek = this.crf.dimension(function(d) {
                return moment(d.t).isoWeekday();
            });

            // It would be better to use moment.weekdaysShort(), but that
            // would require an API to set moment locale to be complete.
            var days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            return {
                groupName: "Day of week", dimension: perDayOfWeek, group: perDayOfWeek.group(),
                keyFormatter: function(k) {
                    return days[k-1];
                }
            };
        },

        makePerHourGroup_: function() {
            var perHour = this.crf.dimension(function(d) {
                var h = d.t.getHours();
                if (h < 6)
                    return "Night";
                else if (h < 12)
                    return "Morning";
                else if (h < 18)
                    return "Afternoon";
                else if (h < 23)
                    return "Evening";
            });

            return {groupName: "Time of day", dimension: perHour, group: perHour.group()};
        },

        makeAdditionalGroups_: function() {

            return [
                this.makePerDayOfWeekGroup_(),
                this.makePerHourGroup_()              
            ];
        },

        computeRange: function(amount, unit) {
            var units = ["day", "week", "month", "year"];
            if (units.indexOf(unit) == -1)
                throw "Invalid date unit '+ " + unit + "'. Valid values are: " + units;
            
            var last = moment();    
            if (unit !== 'day')
                // Align to week boundary.
                last.endOf('isoWeek');
            
            var first = moment(last);
            first.subtract(amount, unit);

            return [first.toDate(), last.toDate()]
        },        
    });

    LA.View = Base.extend({

        // Create an instance of a view
        // 
        constructor: function(element, model, options) {
            this.model = model;
            this.$element = (typeof element === "string") ? $(element) : element;
            this.$element.addClass("la");
            this.options = options || {}
            _.defaults(this.options, {
                template: "lean-analytics.html",
                marginLeft: 40
            });

            this.charts = [];

            model.on("changed:state", this.update, this);
            this.update();
        },

        update: function() {

            if (this.model.dataReady())            
            {
                if (!this.graphsCreated_) {
                    this.graphsCreated_ = true;
                    var View = this;                
                    this.$element.load(this.options.template, function() {
                        View.makeGraphs_(View.model);
                    });
                }
                // We assume that after model is fully initialized, nothing
                // can go wrong.
                return;
            }

            if (this.$progress == undefined) {
                var $progressBlock = $("\
                <div class='progress'>\
                    <div>Loading data</div>\
                    <div class='progress-bar-background'>\
                        <div class='progress-bar' role='progressbar' aria-valuenow='60' aria-valuemin='0' aria-valuemax='100'>\
                        </div>\
                    </div>\
                </div>");
                this.$element.append($progressBlock);
                this.$progress = $progressBlock.find(".progress-bar");
            }

            this.$progress.css('width', this.model.loadedPercentage() + '%');            
            
        },

        initializeDropdown: function($element, metrics, selected, setSelected, nameAccessor)
        {
            nameAccessor = nameAccessor || function(d) { return d.name; };

            var $button = $element.find('button');
            var $dropdown = $element.find('ul.dropdown-menu');
            
            $button.find('span:first').text(nameAccessor(selected));

            metrics.forEach(function(d) {

                var $item = $("<li><a href='#'>" + nameAccessor(d) + "</a></li>");
                $dropdown.append($item);
                
                $item.find("a").click(function(e) {
                    setSelected(d);

                    $button.find('span:first').text(nameAccessor(d));
                });
            });
        },

        defaultValueFormatter: function(v)
        {
            function groupBy3(s)
            {
                var r = "";
                var l = s.length;
                var i;
                for (i = 0; i < l; ++i) {
                    var d = l-i;
                    if (i != 0 && d % 3 == 0)
                        r += " ";
                    r += s[i];
                }
                return r;
            }

            if (typeof v === 'number') {
                return groupBy3(Math.round(v).toString());
            } else {
                return v;
            }
        },

        updateChart: function(chart, data, defaultKeyFormatter)
        {
            var name;
            if (data.groupName && data.metricName) {
                name = data.metricName + " by " + data.groupName;
            } else {
                name = data.metricName;
            }
            name = this.capitalize(name);
            chart
                .dimension(data.dimension)
                .group(data.group, name);
            var keyFormatter = data.keyFormatter || defaultKeyFormatter || function(k) { return k; }
            var valueAccessor = data.valueAccessor || function(d) { return d.value; }
            var valueFormatter = data.valueFormatter || this.defaultValueFormatter;

            chart.valueAccessor(valueAccessor)
            chart.title(function(d) { return keyFormatter(d.key) + ": " + valueFormatter(valueAccessor(d)); });
            chart.label(function(d) { return keyFormatter(d.key); });
        },

        dateFormatter: d3.time.format("%Y-%m-%d"),

        updateCharts: function() {

            var data = this.model.graphData();

            if (data.length != this.charts.length)
                throw "Different number of charts in model and view";

            // FIXME: don't special-case first. Just match everything.
            //this.mainChart.dimension(data[0][0].dimension);
            //this.mainChart.group(data[0][0].group);

            this.updateChart(this.charts[0][0], data[0][0], this.dateFormatter);
            this.updateChart(this.charts[0][1], data[0][1], this.dateFormatter);

            var i;
            for (i = 1; i < data.length; ++i) {
                var g = data[i][0];
                this.updateChart(this.charts[i][0], g);

                var $div = this.charts[i][0].$container;
                $div.find("span.secondary-chart-title").text(g.groupName);
                $div.find("span.secondary-chart-subtitle").text(this.capitalize("Total " + g.metricName + " by " + g.groupName));

            }
        },

        makeGraphs_: function(model) {
            
            var mainChart = this.mainChart = dc.compositeChart(this.$element.find("#primary")[0]);
            var mainMetricChart;
            var derivedMetricChart;

            var $rangeSelector = this.$element.find("#range-selector");
            var $rangeDisplay = this.$element.find(".range-display");

            function updateRangeDisplay(range) {
                $rangeDisplay.text(moment(range[0]).format('MMM D YYYY') + " to " + moment(range[1]).format('MMM D YYYY'));                
            }
            updateRangeDisplay(model.range());

            model.ranges().forEach(function(r) {
                var name = r.name;
                var range = r.range;            
                var active = (model.range() == range);

                var $label = $("<label class='btn btn-default'></label>");
                if (active)
                    $label.addClass('active')
                $label.text(name);

                var $input = $("<input type='radio'>");
                if (active)
                    $input.prop('checked', true);

                $input.change(function (e) {
                    if ($input.is(":checked")) {                        
                        model.range(range);
                        // One would have thought elasticX dc option to work fine.
                        // But, crossfilter's groups are not filtered, only entries
                        // are. So, even though we set filter, we'll get groups for
                        // all times, just some will have no records, and as result,
                        // elasticX will cause X axis to cover all time range. Set
                        // time range explicitly.
                        mainChart.x().domain(range);
                        updateRangeDisplay(range);
                        // TODO: this do this using events.
                        dc.renderAll();
                    }

                });

                $label.append($input);
                $rangeSelector.append($label);
            });

            mainChart
            .width(1140)
            .height(400)
            .dimension(model.valueByTimeUnit)
            .margins({top: 10, right: 10, bottom: 30, left: this.options.marginLeft})
            .x(d3.time.scale().domain(model.range()).nice(d3.time.day))
            .xUnits(d3.time.weeks)        
            //.y(d3.scale.sqrt())
            // This requires a dc.js fix.
            .elasticY(true)
            //.yAxisLabel("The Y Axis")
            .legend(dc.legend().x(80).y(20).itemHeight(13).gap(5))
            .renderHorizontalGridLines(true)
            .compose([
                mainMetricChart = 
                dc.barChart(mainChart)
                .dimension(model.valueByTimeUnit)
                .colors('steelblue')
                .centerBar(true)                 
                ,
                derivedMetricChart = 
                dc.lineChart(mainChart)
                .dimension(model.valueByTimeUnit)
                .colors('red')
                ])
            .brushOn(false)
            ;

            this.charts.push([mainMetricChart, derivedMetricChart]);


            mainChart.xAxis().tickFormat(d3.time.format("%Y-%m-%d"))

            this.initializeDropdown(
                this.$element.find("#main-metric-selector"),
                model.mainMetrics(),
                model.mainMetric(),
                function(d) { model.mainMetric(d); });

            this.initializeDropdown(
                this.$element.find("#derived-metric-selector"),
                model.derivedMetrics(),
                model.derivedMetric(),
                function(d) { model.derivedMetric(d); });

            model.graphData().slice(1).forEach(function(g) {

                g = g[0];

                var $secondary = $(this.$element.find("#secondary")[0]);

                var useLinearChart = true;

                var $div;
                var chart;

                if (useLinearChart) {

                    var $div = $("<div class='col-lg-12'><span class='secondary-chart-title'></span> <span class='secondary-chart-subtitle'></span><div style='height: 50px'></div></div>");
                    $secondary.append($div);

                   chart = unrolledPieChart($div.children('div')[0]);
                   chart.$container = $div;
                   chart.cap(10);

                   chart.elasticX(true)
                   .width(1140).height(65)
                   .margins({top: 10, right: 10, bottom: 30, left: this.options.marginLeft});

                } else {

                    var $div = $("<div class='col-lg-4'><span class='secondary-chart-title'></span> <span class='secondary-chart-subtitle'></span><div style='height: 200px'></div></div>");
                    $secondary.append($div);

                   chart = dc.rowChart($div.children('div')[0]);
                   chart.$container = $div;

                   chart.elasticX(true)
                   .width(250).height(200)      
                    .margins({top: 10, right: 10, bottom: 30, left: this.options.marginLeft});
                }
                
                this.charts.push([chart]);
            }.bind(this));

            var View = this;
            dc.registerChart({
                render: function() {
                    this.redraw();
                },

                redraw: function() {
                    View.updateTable();
                }
            });

            this.updateCharts();

            this.listenTo(this.model, 'change:mainMetric change:derivedMetric', function() {
                this.updateCharts();
                dc.renderAll();
            });

       
            dc.renderAll();

        },

        updateSecondaryChartTitle: function(chart, chartData) {

        },

        updateTable: function() {

            var data = this.model.topEntries(40);
            var table = d3.select(this.$element.find('#table')[0]);

            var thead = table.select("thead");
            thead.select("th").text(this.model.mainMetric().name);
            var tbody = table.select("tbody");
 
            var rows = tbody.selectAll("tr").data(data);
    
            var entered_rows = rows.enter().append("tr");
            entered_rows.append("td");
            entered_rows.append("td");

            rows.classed("gain", function(d) { 
                return d.value > 0; 
            });


            var accessor = this.model.mainMetric().valueAccessor;
            var formatter = this.model.mainMetric().valueFormatter || this.defaultValueFormatter;
            if (1) {
                // Using of function when calling data is documented to
                // get hold of data elements from the higher level groups,
                // which are rows.
                var cells = rows.selectAll("td").data(function(d) { 
                    return [formatter(accessor(d)), d.key];
                });

                cells.text(function(d) { return d; });

            } else {
                // This does not really work. 'd' appears to be right for
                // extra rows, but for rows that already exist it is
                // equal to previous data. I could not find satisfactory
                // explanation what the 'd' parameter is.
                var cells = rows.selectAll("td").text(function(d, i) {
                    if (i == 0) {
                        return d.name;
                    } else {
                        return d.count;
                    }
                });

                cells.text(function(d) { return d; });
            }
   
            rows.exit().remove();
        },

        capitalize: function(s) {
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

        }

    });

    return LA;
 
});
