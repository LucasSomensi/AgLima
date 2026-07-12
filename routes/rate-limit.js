function createIpRateLimiter({ windowMs, max, message }) {
  const hitsByIp = new Map();

  function prune(now) {
    for (const [ip, entry] of hitsByIp.entries()) {
      if (entry.resetAt <= now) {
        hitsByIp.delete(ip);
      }
    }
  }

  function middleware(req, res, next) {
    const now = Date.now();
    prune(now);

    const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    const current = hitsByIp.get(ip);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

    entry.count += 1;
    hitsByIp.set(ip, entry);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).send(message);
    }

    return next();
  }

  middleware.reset = () => hitsByIp.clear();
  middleware._hitsByIp = hitsByIp;

  return middleware;
}

const loginRateLimiter = createIpRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.',
});

const contactRateLimiter = createIpRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: 'Muitos envios de contato. Aguarde alguns minutos e tente novamente.',
});

module.exports = {
  contactRateLimiter,
  createIpRateLimiter,
  loginRateLimiter,
};
