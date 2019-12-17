var url = require('url');
var http = require('http');
var https = require('https');

var debug = require('debug')('mjpeg-proxy');
var debugClient = require('debug')('mjpeg-proxy:client');
var debugMjpeg = require('debug')('mjpeg-proxy:mjpeg');

function extractBoundary(contentType) {
  var startIndex = contentType.indexOf('boundary=');
  var endIndex = contentType.indexOf(';', startIndex);
  if (endIndex == -1) { //boundary is the last option
    // some servers, like mjpeg-streamer puts a '\r' character at the end of each line.
    if ((endIndex = contentType.indexOf('\r', startIndex)) == -1) {
      endIndex = contentType.length;
    }
  }
  return contentType.substring(startIndex + 9, endIndex).replace(/"/gi,'').replace(/^\-\-/gi, '');
}

exports.MjpegProxy = function(options) {
  var self = this;
  self.options = options || {};
  if (!self.options.mjpegUrl) throw new Error('Please provide a source MJPEG URL');

  self.mjpegOptions = url.parse(self.options.mjpegUrl);

  self.audienceResponses = [];
  self.newAudienceResponses = [];

  self.boundary = null;
  self.globalMjpegResponse = null;
  self.mjpegRequest = null;

  self.proxyRequest = function(req, res) {
    debugClient('New proxy request received');
    // There is already another client consuming the MJPEG response
    if (self.mjpegRequest !== null) {
      self._newClient(req, res);
    } else {
      // Send source MJPEG request
      self.mjpegResponseHandler = function(mjpegResponse) {
        // console.log('request');
        self.globalMjpegResponse = mjpegResponse;
        self.boundary = extractBoundary(mjpegResponse.headers['content-type']);

        self._newClient(req, res);

        var lastByte1 = null;
        var lastByte2 = null;

        mjpegResponse.on('data', function(chunk) {
          // Fix CRLF issue on iOS 6+: boundary should be preceded by CRLF.
          if (lastByte1 != null && lastByte2 != null) {
            var oldheader = '--' + self.boundary;
            var p = chunk.indexOf(oldheader);

            if (p == 0 && !(lastByte2 == 0x0d && lastByte1 == 0x0a) || p > 1 && !(chunk[p - 2] == 0x0d && chunk[p - 1] == 0x0a)) {
              var b1 = chunk.slice(0, p);
              var b2 = new Buffer('\r\n--' + self.boundary);
              var b3 = chunk.slice(p + oldheader.length);
              chunk = Buffer.concat([b1, b2, b3]);
            }
          }

          lastByte1 = chunk[chunk.length - 1];
          lastByte2 = chunk[chunk.length - 2];

          for (var i = self.audienceResponses.length; i--;) {
            var res = self.audienceResponses[i];

            // First time we push data... lets start at a boundary
            if (self.newAudienceResponses.indexOf(res) >= 0) {
              var p = chunk.indexOf('--' + self.boundary);
              if (p >= 0) {
                debugClient('Sending first image for client');
                res.write(chunk.slice(p));
                self.newAudienceResponses.splice(self.newAudienceResponses.indexOf(res), 1); // remove from new
              }
            } else {
              res.write(chunk);
            }
          }
        });
        mjpegResponse.on('end', function () {
          debugMjpeg('MJPEG Response has been ended');
          for (var i = self.audienceResponses.length; i--;) {
            var res = self.audienceResponses[i];
            res.end();
            cleanAudienceResponse(res);
          }
        });
        mjpegResponse.on('close', function () {
          debugMjpeg('Response has been closed');
          self.mjpegRequest = null;
        });
      };

      self.mjpegRequest = createRequest();
      
      self.mjpegRequest.on('error', function(e) {
        debugMjpeg('Error with request: %s', e.message);
        // console.error('problem with request: ', e);
        self.mjpegRequest = null;
        self.retryCount = 0;
        var retry = function () {
          if (self.mjpegRequest === null) {
            debugMjpeg('Retry MJPEG request');
            console.log('Retrying request');
            self.retryCount++;
            self.mjpegRequest = createRequest();

            self.mjpegRequest.on('error', function (error) {
              self.mjpegRequest = null;
              const maxRetries = 10;
              if (self.retryCount < maxRetries) {
                setTimeout(retry, 500);
              } else {
                console.log('Failed after', maxRetries, 'tries close all clients', error);
                debugMjpeg('Failed with error \'%s\' after %d tries close all clients', error, maxRetries);
                for (var i = self.audienceResponses.length; i--;) {
                  var res = self.audienceResponses[i];
                  res.end();
                  cleanAudienceResponse(res);
                }
              }
            })
          }
        };
        setTimeout(retry, 500);
      });
      self.mjpegRequest.end();
    }
  };

  function createRequest () {
    debugMjpeg('Send MJPEG request');
    if (self.options.forceHttps === true) {
      return https.request(self.mjpegOptions, self.mjpegResponseHandler);
    } else {
      return http.request(self.mjpegOptions, self.mjpegResponseHandler);
    }
  }

  function cleanAudienceResponse(res) {
    debugClient('Clean audience responses total clients %d with %d', self.audienceResponses.length, self.newAudienceResponses.length);
    var indexOf = self.audienceResponses.indexOf(res);

    if (indexOf >= 0) {
     self.audienceResponses.splice(indexOf, 1);
    }
    if (self.newAudienceResponses.indexOf(res) >= 0) {
      self.newAudienceResponses.splice(self.newAudienceResponses.indexOf(res), 1); // remove from new
    }

    if (self.audienceResponses.length === 0) {
      debugClient('No listening clients');
      self.mjpegRequest = null;
      if (self.globalMjpegResponse) {
        debugMjpeg('Destroying MPJEG response');
        self.globalMjpegResponse.destroy();
      }
    }
  }

  self._newClient = function(req, res) {
    if (res.headersSent === false) {
      res.writeHead (200, {
        'Expires': 'Mon, 01 Jul 1980 00:00:00 GMT',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Content-Type': 'multipart/x-mixed-replace;boundary=' + self.boundary
      });

      self.audienceResponses.push (res);
      self.newAudienceResponses.push (res);
      debugClient('Total clients %d with %d', self.audienceResponses.length, self.newAudienceResponses.length);

      req.on ('close', function () {
        debugClient('Client request is closed');
        cleanAudienceResponse (res);
      });
    }
  }
};