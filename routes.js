var MjpegProxy = require('./mjpeg-proxy').MjpegProxy;

module.exports = function(app) {
  //Directory
  app.get('/', (req, res) => {
  	let routes = {
  		routes: [
  			"http://192.168.0.50",
  			"http://192.168.0.51",
  			"http://192.168.0.52",
  			"http://192.168.0.53",
  			"http://192.168.0.54",
  		]
  	}
  	res.send(routes);
  });

  //cameras
  app.get('/cocina', new MjpegProxy({mjpegUrl: 'http://192.168.0.50'}).proxyRequest);
}