
var Model = LeanAnalytics.Model.extend({

    makeAdditionalGroups_: function() {

        var perCategory = this.crf.dimension(function(d) {                
            return d.category || d.name;
        });

        return [
            {name: "Category", dimension: perCategory, group: perCategory.group()},
            this.makePerDayOfWeekGroup_()
        ];
    },

});

var model = new Model();
model.load("expenses.json");
var view = new LeanAnalytics.View('#lean-analytics', model, {
    template: "../../dist/lean-analytics.html"
});
