const express = require('express');
const path = require('path');
const indexRouter = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse form submissions and JSON request bodies before routing
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Use the router for handling routes
app.use('/', indexRouter);

app.use((error, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413
      : error.type === 'entity.parse.failed' ? 400
        : error.status === 415 ? 415 : 500;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ code: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INTERNAL_ERROR',
      error: status === 413 ? 'A requisição excede 100 KB.' : status === 400 ? 'JSON inválido.' : status === 415 ? 'Codificação do corpo não suportada.' : 'Não foi possível concluir a operação.' });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).send('A requisição excede o tamanho permitido.');
  }

  return next(error);
});

// Catch-all route for handling 404 errors
app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
  });

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
  });
}

module.exports = app;
