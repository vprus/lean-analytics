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

        // Called with the data loaded from server or passed to
        // constructor, and must return an array of elements,
        // each having 't' field of type Date. May modify the
        // parameter at will, but must always return a value.
        prepareData: function(data) {

            data.forEach(function(d) {
                d.t = new Date(d.t);
            });

            return data;
        },

        initialize: function(data) {

            data = this.prepareData(data);

            this.data_ = data;
            this.crf = crossfilter(data);
            this.timeDimension = this.crf.dimension(function(d) { return d.t; });

            this.ranges_ = this.makeRanges();

            this.baseMetrics_ = this.makeBaseMetrics();
            this.derivedMetrics_ = this.makeDerivedMetrics();
        
            this.initializeData_();

            // Now try to apply reasonable defaults.
            this.range(this.ranges_[0].range);
            this.baseMetric(this.baseMetrics()[0]);
            this.derivedMetric(this.derivedMetrics()[0]);            
        },

        // Return the timestamp of a data entry. Default implementation returns
        // the 't' field.
        entryTime_: function(entry) {
            return entry.t;
        },

        timelineData: function() {
            return this.timelineData_;
        },

        categoryData: function() {
            return this.categoryData_;
        },

        tableData: function() {
            return this.tableData_;
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

        makeAllTimeRange: function() {
            var first = this.timeDimension.bottom(1)[0].t;
            return {name: "All time", range: [new Date(first), new Date()]};
        },

        makeRanges: function() {

            return [
                this.makeAllTimeRange(),
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
        baseMetrics: function() {
            return this.baseMetrics_;
        },

        baseMetric: function(metric) {
            if (!arguments.length) return this.baseMetric_;

            if (this.baseMetrics_.indexOf(metric) == -1)
                throw "Invalid base metric";

            if (this.baseMetric_ === metric)
                return;

            function updateDisplayData(data, metric)
            {
                data.metricName = metric.name;
                data.group.reduce(metric.reduceAdd, metric.reduceRemove, metric.reduceInitial);
                data.valueAccessor = metric.valueAccessor;
                data.group.order(function(v) { 
                    return metric.valueAccessor({value: v}); 
                });
            }

            // We intentionally change only [0], as [1] should have the name of derived metric,
            // and the pseudo-group
            updateDisplayData(this.timelineData_[0], metric);

            this.categoryData_.forEach(function(gd) {
                updateDisplayData(gd, metric);
            });

            updateDisplayData(this.tableData_, metric);

            this.baseMetric_ = metric;
            this.trigger('change:baseMetric', this);

            return this;
        },

        topEntries: function(k) {
            var r = this.entriesByNameGroup.top(k);
            var va = this.baseMetric_.valueAccessor;
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

            var d = this.timelineData_[1];
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

            var valueByTimeUnit = this.crf.dimension(function(d) { 
                return moment(d.t).startOf('isoWeek').toDate(); 
            });        
            var group = valueByTimeUnit.group();

            this.timelineData_ = [
                // FIXME: use groupName everywhere.
                {groupName: "week", dimension: valueByTimeUnit, group: group},
                // group and dimension comes from derived metric.
                {dimension: valueByTimeUnit}
            ];

            this.categoryData_ = this.makeCategoryGroups();

            this.tableData_ = this.makeTableGroup();
        },

        makeCountMetric: function(name) {

            function reduceInitial() { return 0; }
            function reduceAdd(p, v) { return p += 1; }
            function reduceRemove(p, v) { return p -= 1; }

            return {
                name: name,
                reduceInitial: reduceInitial, reduceAdd: reduceAdd, reduceRemove: reduceRemove,
                valueAccessor : function (d) { return d.value; }
            }
        },

        makeSumMetric: function(name, extractValue) {
            function reduceInitial() { return 0; }
            function reduceAdd(p, d) { return p += extractValue(d); }
            function reduceRemove(p, d) { return p -= extractValue(d); }

            return {
                name: name,
                reduceInitial: reduceInitial, reduceAdd: reduceAdd, reduceRemove: reduceRemove,
                valueAccessor : function(d) { return d.value; }
            }
        },

        makeBaseMetrics: function() {

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
                    
                    var metric = model.timelineData()[0];
                    
                    var raw = [];
                    metric.group.all().forEach(function (d) {
                        if (d.key.getTime() >= model.range()[0].getTime())
                            raw.push([d.key, metric.valueAccessor(d)]);
                    });

                    return processor(raw).map(function(d) { return {key: d[0], value: d[1]}; });
                }
            }
        },

        makeLinearRegressionDerivedMetric: function() {

            var regression_group = this.makeDerivedMetricGroup_(function(data) {
                data.forEach(function(d) { d[0] = d[0].getTime(); });
                return regression('linear', data).points.map(function(d) {
                    return [new Date(d[0]), d[1]];
                });
            });

            return {name: "Linear regression", group: regression_group};
        },

        makeCumulativeDerivedMetric: function() {

            var cumulative_group = this.makeDerivedMetricGroup_(function(data) {
                var total = 0;
                data.forEach(function(d) {
                    total += d[1];
                    d[1] = total;
                });
                return data;
            });

            return {name: "Cumulative", group: cumulative_group};
        },

        makeAverageDerivedMetric: function(win) {

            win = win || 4;
            var average_group = this.makeDerivedMetricGroup_(function(data) {
            
                for (i = data.length - 1; i - win + 1 >= 0; --i) {
                    var sum = 0.0;
                    var j;
                    for (j = 0; j < win; ++j)
                        sum += data[i - j][1];
                    data[i][1] = sum/win;
                }

                return data;
            });

            return {name: "Smoothed (" + win + "-week average)", group: average_group};
        },

        makeGaussianDerivedMetric: function(degree) {

            degree = degree || 4;

            var model = this;

            var smooth_group = {
                all: function() {

                    var metric = model.timelineData()[0];
                    
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
                    raw2 = smooth(raw2, degree);

                    var i;
                    var result = []
                    for (i = 0; i < raw2.length; ++i) {
                        result.push({key: new Date(raw[i + degree - 1][0]), value: raw2[i]});
                    }
                    
                    return result;
                }
            };

            var w = degree * 2 - 1;
            return {name: "Smoothed (" + w + "-week gaussian)", group: smooth_group};
        },

        makeDerivedMetrics: function() {

            return [
                this.makeLinearRegressionDerivedMetric(),
                this.makeCumulativeDerivedMetric(),
                this.makeAverageDerivedMetric(),
                this.makeGaussianDerivedMetric()
            ]
        },

        makePerDayOfWeekGroup: function() {

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

        makePerHourGroup: function() {
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

        makeCategoryGroups: function() {

            return [
                this.makePerDayOfWeekGroup(),
                this.makePerHourGroup()
            ];
        },

        makeTableGroup: function() {
            var dimension = this.crf.dimension(function(d) { return d.name; });
            return {
                groupName: "Name",
                dimension: dimension,
                group: dimension.group()
            }
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
            this.categoryCharts = [];

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

            // FIXME: charts->timelineCharts and check lenghts.
            var timelineData = this.model.timelineData();
            this.updateChart(this.charts[0][0], timelineData[0], this.dateFormatter);
            this.updateChart(this.charts[0][1], timelineData[1], this.dateFormatter);

            var categoryData = this.model.categoryData();
            if (categoryData.length != this.categoryCharts.length)
                throw "Different number of category charts in model and view";

            var i;
            for (i = 0; i < categoryData.length; ++i) {

                var d = categoryData[i];
                var c = this.categoryCharts[i];
                this.updateChart(c, d)

                var $div = c.$container;
                $div.find("span.secondary-chart-title").text(d.groupName);
                $div.find("span.secondary-chart-subtitle").text(this.capitalize("Total " + d.metricName + " by " + d.groupName));
            }

        },

        makeGraphs_: function(model) {
            
            var mainChart = this.mainChart = dc.compositeChart(this.$element.find("#primary")[0]);
            var baseMetricChart;
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
            .margins({top: 10, right: 0, bottom: 30, left: this.options.marginLeft})
            .x(d3.time.scale().domain(model.range()).nice(d3.time.day))
            .xUnits(d3.time.weeks)        
            //.y(d3.scale.sqrt())
            // This requires a dc.js fix.
            .elasticY(true)
            //.yAxisLabel("The Y Axis")
            .legend(dc.legend().x(80).y(20).itemHeight(13).gap(5))
            .renderHorizontalGridLines(true)
            .compose([
                baseMetricChart = 
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

            this.charts.push([baseMetricChart, derivedMetricChart]);


            mainChart.xAxis().tickFormat(d3.time.format("%Y-%m-%d"))

            this.initializeDropdown(
                this.$element.find("#base-metric-selector"),
                model.baseMetrics(),
                model.baseMetric(),
                function(d) { model.baseMetric(d); });

            this.initializeDropdown(
                this.$element.find("#derived-metric-selector"),
                model.derivedMetrics(),
                model.derivedMetric(),
                function(d) { model.derivedMetric(d); });

            model.categoryData().forEach(function(g) {
                
                var $secondary = $(this.$element.find("#secondary")[0]);

                var useLinearChart = true;

                var $div;
                var chart;

                if (useLinearChart) {

                    var $div = $("<div class='col-lg-12'><span class='secondary-chart-title'></span> <span class='secondary-chart-subtitle'></span>  <a class='reset pull-right' style='display: none;'>Clear filters</a></div></div>");
                    $secondary.append($div);

                   chart = unrolledPieChart($div[0]);
                   chart.$container = $div;
                   chart.cap(10);

                   chart.elasticX(true)
                   .width(1140).height(35).fixedBarHeight(20)
                   .margins({top: 10, right: 0, bottom: 30, left: this.options.marginLeft});

                   $div.find("a").click(function() {
                        chart.filterAll();
                        dc.redrawAll();
                   });

                } else {

                    // Note: this branch is not used right now, and probably won't work.
                    var $div = $("<div class='col-lg-4'><span class='secondary-chart-title'></span> <span class='secondary-chart-subtitle'></span><div style='height: 200px'></div></div>");
                    $secondary.append($div);

                   chart = dc.rowChart($div.children('div')[0]);
                   chart.$container = $div;

                   chart.elasticX(true)
                   .width(250).height(200)      
                    .margins({top: 10, right: 10, bottom: 30, left: this.options.marginLeft});
                }
                
                this.categoryCharts.push(chart);
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

            this.listenTo(this.model, 'change:baseMetric change:derivedMetric', function() {
                this.updateCharts();
                dc.renderAll();
            });

       
            dc.renderAll();

        },

        updateSecondaryChartTitle: function(chart, chartData) {

        },

        updateTable: function() {

            var tableData = this.model.tableData();
            var data = tableData.group.top(40);
            var va = tableData.valueAccessor;
            // crossfilter removes elements from groups when filtering, but does not remove
            // the grops. Further, with floating point filtering out can result in value close
            // to zero, but not quite zero. Filter out such useless groups.
            data = data.filter(function(d) { return Math.abs(va(d)) > 0.00001; })

            var div = this.$element.find('#table')[0]
            var $div = $(div);
            $div.find("span.table-title").text(tableData.groupName);
            $div.find("span.table-subtitle").text(this.capitalize("Total " + tableData.metricName + " by " + tableData.groupName));

            var table = d3.select(div);
            table.select("table").style("margin-left", this.options.marginLeft + "px");

            //var thead = table.select("thead");
            //thead.select("th").text(tableData.metricName);
            var tbody = table.select("tbody");
 
            var rows = tbody.selectAll("tr").data(data);
    
            var entered_rows = rows.enter().append("tr");
            entered_rows.append("td");
            entered_rows.append("td");

            rows.classed("gain", function(d) { 
                return d.value > 0; 
            });


            var accessor = this.model.baseMetric().valueAccessor;
            var formatter = this.model.baseMetric().valueFormatter || this.defaultValueFormatter;
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
