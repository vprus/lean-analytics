
var Model = LeanAnalytics.Model.extend({

    makeMainMetrics_: function() {
        var r = LeanAnalytics.Model.prototype.makeMainMetrics_.call(this);
        r[0].name = "Amount";
        r[1].name = "Transaction Count";
        return r;
    },

    makeAdditionalGroups_: function() {

        var perCategory = this.crf.dimension(function(d) {                
            return d.category || d.name;
        });

        return [
            {groupName: "Category", dimension: perCategory, group: perCategory.group()},
            this.makePerDayOfWeekGroup_()
        ];
    },

});

var model = new Model();
model.load("expenses.json");
var view = new LeanAnalytics.View('#lean-analytics', model, {
    template: "../../dist/lean-analytics.html"
});
