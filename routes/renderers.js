module.exports = {
  ...require('./renderers/admin-renderer'),
  ...require('./renderers/auth-renderer'),
  ...require('./renderers/dryer-renderer'),
  ...require('./renderers/weighbridge-renderer'),
};
