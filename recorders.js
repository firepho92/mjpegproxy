const request = require('request');
var fs = require('fs');

module.exports = function() {
  var date = new Date();
  var cocinaStreaming = request.get('http://localhost:3000/barra');
  var cocinaVideo = fs.createWriteStream('barra-' + date.getHours() + '_' + date.getMinutes() + '_' + date.getSeconds() + '-' + date.getDate() + '-' + date.getMonth() + '-' + date.getFullYear() + '.mjpeg');
  cocinaStreaming.pipe(cocinaVideo);
}