// CMS Configuration
// ---------------------------------------------------------
// ADMIN_HASH: SHA-256 da senha de acesso ao CMS.
// Senha padrão: Blog2026!  (troque antes de usar em produção)
//
// Para gerar um novo hash no console do browser:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('suasenha'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// ---------------------------------------------------------
const ADMIN_HASH = 'e6282165a65c0d824e4ff3cef53a076bb4ecf009de46288b81ed982380221b49';

// Repositório GitHub onde o site está hospedado
const GITHUB_OWNER = 'brnYoseph';
const GITHUB_REPO  = 'bruno-ventorin';
const POSTS_PATH   = 'content/posts.json';
