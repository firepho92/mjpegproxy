var express = require('express');
var app = express();
var routes = require('./routes');
var record = require('./recorders');
routes(app);
//record();

app.listen(3010, function () {
  console.log('Example app listening on port 3000!');
});