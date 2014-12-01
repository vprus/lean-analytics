
d3.json("expenses.json", function(error, expenses) {

    expenses.forEach(function(d) {
       d.t = new Date(d.t);
    });

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

    var model = new Model(expenses);
    var view = new LeanAnalytics.View('#lean-analytics', model, {
        template: "../../dist/lean-analytics.html"
    });

});
