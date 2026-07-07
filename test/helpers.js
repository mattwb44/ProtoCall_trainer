export async function signup(base, { email, password = 'hunter22222', display_name = 'Test User', guest_token } = {}) {
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name, guest_token }),
  });
  const body = await res.json();
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, body, cookie };
}

export const authed = cookie => ({ 'Content-Type': 'application/json', cookie });

export const emit = (sock, event, payload) =>
  new Promise(res => sock.emit(event, payload, res));

export const once = (sock, event) =>
  new Promise(res => sock.once(event, res));
