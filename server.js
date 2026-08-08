const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Resolver la ruta del archivo solicitado
  let urlPath = req.url.split('?')[0];
  let filePath = urlPath === '/' 
    ? path.join(__dirname, 'index.html')
    : path.join(__dirname, urlPath);
    
  // Prevenir acceso fuera del directorio del workspace por seguridad
  const relative = path.relative(__dirname, filePath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (urlPath !== '/' && !isSafe) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>');
    return;
  }
  
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Archivo No Encontrado</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>500 Error Interno</h1><p>${err.code}</p>`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Servidor Local Industrial OT iniciado con éxito `);
  console.log(` Acceso HMI: http://localhost:${PORT} `);
  console.log(`======================================================\n`);
});
