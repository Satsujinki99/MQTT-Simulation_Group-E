const fs = require('fs');

try {
  const ca = fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/ca.crt');
  console.log('CA certificate loaded, size:', ca.length);

  const cert = fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/client.crt');
  console.log('Client certificate loaded, size:', cert.length);

  const key = fs.readFileSync('/Users/furqonaryadana/mosquitto/certs/client.key');
  console.log('Client key loaded, size:', key.length);

  console.log('All certificates are accessible!');
} catch (err) {
  console.error('Error reading certificate files:', err.message);
}
