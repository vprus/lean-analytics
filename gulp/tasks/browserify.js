
var gulp = require('gulp');
var browserify = require('browserify');
var source = require('vinyl-source-stream');

gulp.task('browserify', function() {

    var bundleStream = browserify({
        entries: ['./src/lean-analytics.js'],
        standalone: "LeanAnalytics"
    }).bundle();

    bundleStream
        .pipe(source('lean-analytics.bundle.js'))
        .pipe(gulp.dest('./dist'))
    ;
});
