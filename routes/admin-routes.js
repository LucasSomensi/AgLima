const express = require('express');
const { requireRoot } = require('./auth');
const { MANAGED_ROLES, ROOT_LOGIN } = require('./constants');
const { renderAdminUsersPage } = require('./renderers');
const {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  updateManagedUserPassword,
} = require('./user-service');
const { buildRedirect } = require('./utils');

const router = express.Router();

function buildAdminRedirect(params) {
  return buildRedirect('/admin/usuarios', params);
}

router.get('/admin/usuarios', requireRoot, async (req, res) => {
  try {
    const users = await listManagedUsers();
    return renderAdminUsersPage(res, {
      users,
      message: req.query.created
        ? 'Usuário criado com sucesso.'
        : req.query.deleted
          ? 'Usuário removido com sucesso.'
          : req.query.password
            ? 'Senha atualizada com sucesso.'
            : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error listing users:', error.message);
    return res.status(500).send('Não foi possível carregar os usuários agora.');
  }
});

router.post('/admin/usuarios', requireRoot, async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();

  if (!login || !password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe login e senha para criar o usuário.' }));
  }

  if (!MANAGED_ROLES.includes(role)) {
    return res.redirect(buildAdminRedirect({ error: 'Selecione um perfil válido para o usuário.' }));
  }

  if (login === ROOT_LOGIN) {
    return res.redirect(buildAdminRedirect({ error: 'O login root já é reservado pelo sistema.' }));
  }

  try {
    await createManagedUser({ login, password, role });
    return res.redirect(buildAdminRedirect({ created: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildAdminRedirect({ error: 'Já existe um usuário com esse login.' }));
    }

    console.error('Error creating user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível criar o usuário agora.' }));
  }
});

router.post('/admin/usuarios/:id/senha', requireRoot, async (req, res) => {
  const password = String(req.body.password || '');

  if (!password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe a nova senha do usuário.' }));
  }

  try {
    await updateManagedUserPassword(req.params.id, password);
    return res.redirect(buildAdminRedirect({ password: '1' }));
  } catch (error) {
    console.error('Error updating user password:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível atualizar a senha agora.' }));
  }
});

router.post('/admin/usuarios/:id/remover', requireRoot, async (req, res) => {
  try {
    await deleteManagedUser(req.params.id, req.sessionUser.userId);
    return res.redirect(buildAdminRedirect({ deleted: '1' }));
  } catch (error) {
    console.error('Error deleting user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível remover o usuário agora.' }));
  }
});

module.exports = router;
