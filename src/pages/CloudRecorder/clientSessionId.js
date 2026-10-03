// One id per page load, which is one recording host. Two ids against the same
// mediaId means two hosts were writing to it. The same id twice means one
// host re-signed. Deliberately not persisted: a reload is a new host.
let _clientSessionId = null;

export const getClientSessionId = () => {
  if (_clientSessionId) return _clientSessionId;
  try {
    _clientSessionId = crypto.randomUUID();
  } catch {
    _clientSessionId = `cs-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  return _clientSessionId;
};
