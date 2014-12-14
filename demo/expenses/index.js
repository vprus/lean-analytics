
var Model = LeanAnalytics.Model.extend({

    makeRanges: function() {

        // Since we use static sample data, use static date ranges.
        return [
            {name: "All time", range: [new Date("2013-03-29"), new Date("2014-09-26")]},
            {name: "1 year", range: [new Date("2013-09-26"), new Date("2014-09-26")]}
        ]
    },

    makeBaseMetrics: function() {
        var r = LeanAnalytics.Model.prototype.makeBaseMetrics.call(this);
        r[0].name = "Amount";
        r[1].name = "Transaction Count";
        return r;
    },

    makeDerivedMetrics: function() {
        return [
            this.makeGaussianDerivedMetric(),
            this.makeLinearRegressionDerivedMetric()
        ];
    },

    makeCategoryGroups: function() {

        var perCategory = this.crf.dimension(function(d) {                
            return d.category || d.name;
        });

        return [
            {groupName: "Category", dimension: perCategory, group: perCategory.group()},
            this.makePerDayOfWeekGroup()
        ];
    },

});

var model = new Model();
model.load("expenses.json");
var view = new LeanAnalytics.View('#lean-analytics', model, {
    template: "../../dist/lean-analytics.html"
});
