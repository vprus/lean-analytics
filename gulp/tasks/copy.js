
var gulp = require('gulp');

gulp.task('copy', function() {

    gulp.src(['./src/*'], {base: 'src'})
        .pipe(gulp.dest('./dist'));

});
