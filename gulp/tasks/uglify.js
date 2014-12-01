
var gulp = require('gulp');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');

gulp.task('uglify', ['browserify'], function() {
  gulp.src('./src/lean-analytics.js')
        .pipe(uglify())
        .pipe(rename('lean-analytics.min.js'))
        .pipe(gulp.dest('dist'))
  // bundle.js is produced by browserify task,
  // and it appears that this task does not actually
  // wait until 'browserify' task to create the file.
  gulp.src('./dist/lean-analytics.bundle.js')
        .pipe(uglify())
        .pipe(rename('lean-analytics.bundle.min.js'))
        .pipe(gulp.dest('dist'))
});
