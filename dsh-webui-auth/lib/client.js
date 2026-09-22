window.__ModuleLoader__.load({
	id: 'dsh-webui-auth',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let react = require('react');

		const inject = ['slots'];

		const CSS = [
			'.wua-section { display: flex; flex-direction: column; gap: 14px; max-width: 560px; padding: 4px 2px; }',
			'.wua-intro { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-row { display: flex; flex-direction: column; gap: 5px; }',
			'.wua-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-static { font-size: 13px; color: var(--dsw-alias-label-primary, #222); }',
			'.wua-input { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; outline: none; }',
			'.wua-input:focus { border-color: var(--dsw-alias-brand-primary, #4a7cf7); }',
			'/* 深色模式下浏览器自动填充会把输入框刷成白色/黄色：inset 大阴影 + text-fill-color 回压为当前主题输入底色 */',
			'.wua-input:-webkit-autofill, .wua-input:-webkit-autofill:hover, .wua-input:-webkit-autofill:focus { -webkit-text-fill-color: var(--dsw-alias-label-primary, #222); -webkit-box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; box-shadow: 0 0 0 1000px var(--dsw-alias-bg-layer-2, #fff) inset; caret-color: var(--dsw-alias-label-primary, #222); transition: background-color 999999s ease-in-out 0s; }',
			'.wua-input::placeholder { color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-select { box-sizing: border-box; width: 100%; padding: 7px 9px; font-size: 13px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l1, #ccc); border-radius: 4px; outline: none; }',
			'.wua-btn { align-self: flex-start; padding: 7px 18px; font-size: 13px; cursor: pointer; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l2, #999); border-radius: 4px; }',
			'.wua-btn:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary, #555); }',
			'.wua-btn:disabled { opacity: 0.55; cursor: default; }',
			'.wua-btn.ghost { background: transparent; border-color: var(--dsw-alias-border-l1, #ccc); }',
			'.wua-btn.danger { color: var(--dsw-alias-state-error-primary, #d1242f); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d1242f) 45%, transparent); }',
			'.wua-btn.small { padding: 4px 10px; font-size: 12px; }',
			'.wua-btnrow { display: flex; flex-wrap: wrap; gap: 8px; }',
			'.wua-msg { margin: 0; font-size: 12px; color: var(--dsw-alias-state-success-primary, #1a7f37); }',
			'.wua-err { margin: 0; font-size: 12px; color: var(--dsw-alias-state-error-primary, #d1242f); }',
			'.wua-warn { margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-warn-primary, #9a6700); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #9a6700) 10%, transparent); border: 1px solid var(--dsw-alias-state-warn-primary, #9a6700); border-radius: 4px; }',
			'.wua-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #888); border-top: 1px solid var(--dsw-alias-border-l1, #e5e5e5); padding-top: 10px; }',
			'.wua-audit { display: flex; flex-direction: column; gap: 4px; }',
			'.wua-audit-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; font-size: 12px; line-height: 1.6; }',
			'.wua-audit-time { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-audit-event { color: var(--dsw-alias-label-primary, #222); }',
			'.wua-audit-user { color: var(--dsw-alias-state-business-primary, #4176e6); }',
			'.wua-audit-ip { color: var(--dsw-alias-label-tertiary, #999); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }',
			'.wua-users { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1, #e5e5e5); border-radius: 6px; overflow: hidden; }',
			'.wua-user { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1, #e5e5e5); }',
			'.wua-user:first-child { border-top: none; }',
			'.wua-user-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }',
			'.wua-user-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
			'.wua-user-nick { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }',
			'.wua-user-me { font-size: 11px; color: var(--dsw-alias-state-business-primary, #4176e6); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent); border-radius: 10px; padding: 0 7px; }',
			'.wua-user-role { margin-left: auto; }',
			'.wua-user-role .wua-select { width: auto; padding: 4px 8px; font-size: 12px; }',
			'.wua-user-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
			'.wua-user-reset { display: flex; flex: 1 1 220px; gap: 8px; }',
			'.wua-user-reset .wua-input { flex: 1 1 auto; }',
		].join('\n');

		// 密码规则（与服务端 passwordStrength 一致）
		const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~]/;
		function checkPassword(p) {
			if (!p || p.length < 8) return { ok: false, text: '密码至少需要 8 位' };
			if (!/[a-z]/.test(p)) return { ok: false, text: '密码必须包含小写字母' };
			if (!/[A-Z]/.test(p)) return { ok: false, text: '密码必须包含大写字母' };
			if (!/[0-9]/.test(p)) return { ok: false, text: '密码必须包含数字' };
			if (!SPECIAL_CHARS.test(p)) return { ok: false, text: '密码必须包含特殊符号（如 !@#$%^&*）' };
			return { ok: true, text: '' };
		}
		// 用户名规则（与服务端 usernameError 一致）
		function checkUsername(name) {
			return /^[A-Za-z0-9_-]{3,32}$/.test(name);
		}
		function roleLabel(role) {
			return role === 'admin' ? '管理员' : '普通用户';
		}

		// 审计事件显示名
		const EVENT_LABELS = {
			login_success: '登录成功',
			login_failure: '登录失败',
			login_rate_limited: '登录被限流',
			setup_success: '初始化成功',
			setup_failure: '初始化失败',
			configure_success: '修改有效期',
			configure_failure: '修改有效期失败',
			disable_success: '禁用认证',
			disable_failure: '禁用认证失败',
			nickname_changed: '修改昵称',
			password_changed: '修改密码',
			password_reset: '重置密码',
			user_created: '新建用户',
			user_deleted: '删除用户',
			user_role_changed: '调整角色',
			logout: '退出登录',
		};
		function fmtTime(ts) {
			if (!ts) return '?';
			const d = new Date(ts);
			if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19).replace('T', ' ');
			const pad = (n) => String(n).padStart(2, '0');
			return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
		}

		function apply(ctx) {
			const styleEl = document.createElement('style');
			styleEl.setAttribute('data-plugin', 'dsh-webui-auth');
			styleEl.textContent = CSS;
			document.head.appendChild(styleEl);
			ctx.effect(() => () => {
				if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
			}, 'dsh-webui-auth: styles');

			// ---------------- 同源 HTTP API（会话 cookie 由浏览器自动携带） ----------------
			function api(path, body) {
				const opts = body === undefined
					? {}
					: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
				return fetch(path, opts).then((r) => {
					if (r.status === 401) {
						// 会话过期或无效：跳回首页，由 HTTP 层重定向到登录页
						location.href = '/';
						return { ok: false, error: 'unauthorized' };
					}
					return r.json();
				});
			}

			// ---------------- 身份认证页（settings.section） ----------------
			function AuthSettings() {
				const [status, setStatus] = react.useState(null);
				const [password, setPassword] = react.useState('');
				const [confirm, setConfirm] = react.useState('');
				const [current, setCurrent] = react.useState('');
				const [nickname, setNickname] = react.useState('');
				const [nickLoaded, setNickLoaded] = react.useState(false);
				const [ttl, setTtl] = react.useState('12');
				const [msg, setMsg] = react.useState(null);
				const [busy, setBusy] = react.useState(false);
				const [audit, setAudit] = react.useState(null);

				const refreshStatus = () => api('/dsh-webui-auth/status').then((s) => {
					if (s && !s.error) setStatus(s);
					return s;
				});

				react.useEffect(() => {
					let alive = true;
					api('/dsh-webui-auth/status').then((s) => {
						if (!alive || !s || s.error) return;
						setStatus(s);
						setTtl(String(typeof s.ttl === 'number' ? s.ttl : 12));
						setNickname(s.nickname || '');
						setNickLoaded(true);
						// 审计记录含其他用户的登录事件/IP，仅管理员拉取与展示。
						if (s.role === 'admin') {
							api('/dsh-webui-auth/audit?limit=8').then((r) => {
								if (!alive) return;
								if (r && r.ok && Array.isArray(r.entries)) setAudit(r.entries);
							}).catch(() => { /* 审计不可用时静默 */ });
						}
					});
					return () => { alive = false; };
				}, []);

				const enabled = Boolean(status && status.enabled);
				const isAdmin = Boolean(status && status.role === 'admin');

				const onChangePassword = () => {
					if (busy) return;
					const st = checkPassword(password);
					if (!st.ok) { setMsg({ kind: 'err', text: st.text }); return; }
					if (password !== confirm) { setMsg({ kind: 'err', text: '两次输入的密码不一致' }); return; }
					if (!current) { setMsg({ kind: 'err', text: '请输入当前密码' }); return; }
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/change-password', { current, password }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '密码已修改。其他已登录设备的会话已吊销，当前设备保持登录。' });
							setPassword('');
							setConfirm('');
							setCurrent('');
						} else if (r && r.error === 'current-invalid') {
							setMsg({ kind: 'err', text: '当前密码不正确' });
						} else if (r && r.error === 'weak-password') {
							setMsg({ kind: 'err', text: '密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号' });
						} else if (r && typeof r.error === 'string') {
							setMsg({ kind: 'err', text: '修改失败：' + r.error });
						} else {
							setMsg({ kind: 'err', text: '修改失败，请检查输入' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '修改失败：无法连接认证服务' });
					});
				};

				const onNicknameSave = () => {
					if (busy) return;
					const name = nickname.trim();
					if (name.length > 32) { setMsg({ kind: 'err', text: '昵称最多 32 个字符' }); return; }
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/nickname', { nickname: name }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: name ? '昵称已保存，新会话的问候语将展示昵称。' : '昵称已清除，问候语回落到用户名。' });
							refreshStatus();
						} else if (r && r.error === 'nickname-invalid') {
							setMsg({ kind: 'err', text: r.reason || '昵称格式不合法' });
						} else {
							setMsg({ kind: 'err', text: '保存失败，请稍后重试' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '保存失败：无法连接认证服务' });
					});
				};

				const onTtlSave = () => {
					if (busy) return;
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/configure', { ttl: Number(ttl) }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '会话有效期已保存，下次登录起生效。' });
						} else if (r && r.error === 'ttl-invalid') {
							setMsg({ kind: 'err', text: '无效的有效期选项' });
						} else if (r && r.error === 'forbidden') {
							setMsg({ kind: 'err', text: '需要管理员权限' });
						} else {
							setMsg({ kind: 'err', text: '保存失败，请稍后重试' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '保存失败：无法连接认证服务' });
					});
				};

				const onDisable = () => {
					if (busy) return;
					if (!current) { setMsg({ kind: 'err', text: '请输入当前密码以禁用认证' }); return; }
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/disable', { current }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已禁用认证，所有会话已注销。刷新页面后不再要求登录。' });
							setCurrent('');
							refreshStatus();
						} else if (r && r.error === 'forbidden') {
							setMsg({ kind: 'err', text: '需要管理员权限' });
						} else {
							setMsg({ kind: 'err', text: '当前密码不正确' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '操作失败：无法连接认证服务' });
					});
				};

				const onLogout = () => {
					if (busy) return;
					setBusy(true);
					api('/dsh-webui-auth/logout', {}).then(() => {
						location.href = '/';
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '退出失败：无法连接认证服务' });
					});
				};

				const intro = status === null
					? '正在读取认证状态…'
					: (enabled
						? '认证已在 HTTP 层强制执行，当前账号：' + status.username + '（' + roleLabel(status.role) + '）。'
							+ (isAdmin ? '管理员可在「用户管理」页新建/删除用户、重置密码、调整角色。' : '如需新建用户或调整权限，请联系管理员。')
						: '当前未启用认证。访问 WebUI 不需要登录。重启 DeepSeek Harness 会生成一次性 setup token，用它在登录页创建首个账号（自动成为管理员）即可启用认证。');

				const patchWarn = (status && status.gate && !status.gate.ok)
					? ('路由闸门不完整：' + (status.gate.problems && status.gate.problems.join('; ') || '未知原因')
						+ '。认证无法启用，直到 /api 与 WebSocket 路由可被保护。')
					: null;
				const persistNote = (status && status.sessionsPersisted === false)
					? '会话持久化写入失败（磁盘权限？）：dsh 重启后已登录设备需要重新登录。'
					: null;

				const children = [
					react.createElement('p', { key: 'intro', className: 'wua-intro' }, intro),
					patchWarn ? react.createElement('p', { key: 'gate', className: 'wua-warn' }, patchWarn) : null,
					persistNote ? react.createElement('p', { key: 'persist', className: 'wua-warn' }, persistNote) : null,
				];

				if (enabled) {
					children.push(
						react.createElement('div', { key: 'name', className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, '用户名'),
							react.createElement('div', { className: 'wua-static' }, (status && status.username) || '—'),
						),
					);
					if (isAdmin) {
						children.push(
							react.createElement('div', { key: 'nick', className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '昵称（问候语展示用，留空则显示用户名）'),
								react.createElement('div', { className: 'wua-btnrow', style: { flexWrap: 'nowrap', width: '100%' } },
									react.createElement('input', {
										className: 'wua-input',
										type: 'text',
										value: nickname,
										maxLength: 32,
										placeholder: (status && status.username) || '',
										spellCheck: false,
										disabled: !nickLoaded,
										style: { flex: '1 1 auto' },
										onChange: (e) => setNickname(e.target.value),
									}),
									react.createElement('button', {
										className: 'wua-btn',
										style: { flex: '0 0 auto' },
										disabled: busy || !nickLoaded,
										onClick: onNicknameSave,
									}, '保存昵称'),
								),
							),
						);
					}
					children.push(
						react.createElement('div', { key: 'newpw', className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, '新密码（至少 8 位，含大小写、数字、特殊符号）'),
							react.createElement('input', { className: 'wua-input', type: 'password', value: password, onChange: (e) => setPassword(e.target.value) }),
						),
						react.createElement('div', { key: 'confirm', className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, '确认新密码'),
							react.createElement('input', { className: 'wua-input', type: 'password', value: confirm, onChange: (e) => setConfirm(e.target.value) }),
						),
						react.createElement('div', { key: 'cur', className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, isAdmin ? '当前密码（修改密码或禁用认证需验证）' : '当前密码（修改密码需验证）'),
							react.createElement('input', { className: 'wua-input', type: 'password', value: current, onChange: (e) => setCurrent(e.target.value) }),
						),
					);
					if (isAdmin) {
						children.push(
							react.createElement('div', { key: 'ttl', className: 'wua-row' },
								react.createElement('label', { className: 'wua-label' }, '会话有效期（登录后免登录时长，管理员统一设置）'),
								react.createElement('div', { className: 'wua-btnrow', style: { flexWrap: 'nowrap', width: '100%' } },
									react.createElement('select', {
										className: 'wua-select',
										value: ttl,
										disabled: busy || status === null,
										style: { flex: '1 1 auto' },
										onChange: (e) => setTtl(e.target.value),
									},
										react.createElement('option', { key: '0', value: '0' }, '浏览器会话：关闭浏览器后失效'),
										react.createElement('option', { key: '1', value: '1' }, '1 小时'),
										react.createElement('option', { key: '12', value: '12' }, '12 小时（默认）'),
										react.createElement('option', { key: '24', value: '24' }, '1 天'),
										react.createElement('option', { key: '72', value: '72' }, '3 天'),
									),
									react.createElement('button', {
										className: 'wua-btn',
										style: { flex: '0 0 auto' },
										disabled: busy || status === null,
										onClick: onTtlSave,
									}, '保存有效期'),
								),
							),
						);
					}
					children.push(
						msg ? react.createElement('div', { key: 'msg', className: msg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, msg.text) : null,
						react.createElement('div', { key: 'btns', className: 'wua-btnrow' },
							react.createElement('button', { className: 'wua-btn', disabled: busy || status === null, onClick: onChangePassword }, busy ? '处理中…' : '修改密码'),
							isAdmin ? react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onDisable }, '禁用认证') : null,
							react.createElement('button', { className: 'wua-btn ghost', disabled: busy || status === null, onClick: onLogout }, '退出登录'),
						),
						isAdmin ? react.createElement('div', { key: 'audit', className: 'wua-row' },
							react.createElement('label', { className: 'wua-label' }, '最近登录记录（完整审计日志可用 node index.js audit 查看）'),
							audit === null
								? react.createElement('p', { className: 'wua-intro' }, '正在读取…')
								: (audit.length === 0
									? react.createElement('p', { className: 'wua-intro' }, '暂无审计记录')
									: react.createElement('div', { className: 'wua-audit' },
										audit.map((entry, i) => react.createElement('div', { key: i, className: 'wua-audit-row' },
											react.createElement('span', { className: 'wua-audit-time' }, fmtTime(entry.ts)),
											react.createElement('span', { className: 'wua-audit-event' }, EVENT_LABELS[entry.event] || entry.event),
											entry.username ? react.createElement('span', { className: 'wua-audit-user' }, entry.username) : null,
											entry.ip ? react.createElement('span', { className: 'wua-audit-ip' }, entry.ip) : null,
										)),
									)),
						) : null,
						react.createElement('p', { key: 'hint', className: 'wua-hint' },
							'密码规则：至少 8 位，必须包含大写字母、小写字母、数字和特殊符号（如 !@#$%^&*）。认证在 HTTP/传输层强制执行（WebUI 资源、/api 接口、WebSocket 全部要求有效会话），会话保存在服务端并由 HttpOnly Cookie 携带，修改密码会吊销其他所有会话。凭据以 scrypt 哈希保存在插件目录的 dsh-webui-auth.json；忘记密码时删除该文件并重启 DSH 即可重置。'),
					);
				} else {
					children.push(
						msg ? react.createElement('div', { key: 'msg', className: msg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, msg.text) : null,
					);
				}

				return react.createElement('div', { className: 'wua-section' }, children);
			}

			// ---------------- 用户管理页（settings.section，仅管理员注册） ----------------
			function UserAdminSection() {
				const [users, setUsers] = react.useState(null);
				const [msg, setMsg] = react.useState(null);
				const [busy, setBusy] = react.useState(false);
				const [newName, setNewName] = react.useState('');
				const [newPass, setNewPass] = react.useState('');
				const [newRole, setNewRole] = react.useState('user');
				const [resetFor, setResetFor] = react.useState(null);
				const [resetPass, setResetPass] = react.useState('');

				const load = () => api('/dsh-webui-auth/users').then((r) => {
					if (r && r.ok && Array.isArray(r.users)) setUsers(r.users);
					else if (r && r.error === 'forbidden') setUsers([]);
					return r;
				}).catch(() => { /* 列表不可用时保持 null */ });

				react.useEffect(() => {
					let alive = true;
					api('/dsh-webui-auth/users').then((r) => {
						if (!alive) return;
						if (r && r.ok && Array.isArray(r.users)) setUsers(r.users);
						else setUsers([]);
					}).catch(() => { if (alive) setUsers([]); });
					return () => { alive = false; };
				}, []);

				const createErrText = (err) => ({
					'username-invalid': '用户名需为 3-32 位字母、数字、下划线或连字符',
					'username-taken': '用户名已存在',
					'weak-password': '初始密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号',
					'forbidden': '需要管理员权限',
				}[err] || '操作失败，请检查输入');

				const onCreate = () => {
					if (busy) return;
					const name = newName.trim();
					if (!checkUsername(name)) { setMsg({ kind: 'err', text: '用户名需为 3-32 位字母、数字、下划线或连字符' }); return; }
					const st = checkPassword(newPass);
					if (!st.ok) { setMsg({ kind: 'err', text: st.text }); return; }
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/users/create', { username: name, password: newPass, role: newRole }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已新建用户 ' + name + '（' + roleLabel(newRole) + '）。' });
							setNewName('');
							setNewPass('');
							setNewRole('user');
							load();
						} else {
							setMsg({ kind: 'err', text: createErrText(r && r.error) });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '新建失败：无法连接认证服务' });
					});
				};

				const onSetRole = (username, role) => {
					if (busy) return;
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/users/set-role', { username, role }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已将 ' + username + ' 设为' + roleLabel(role) + '。（该用户重新登录后生效）' });
							load();
						} else if (r && r.error === 'last-admin') {
							setMsg({ kind: 'err', text: '不能降级最后一个管理员' });
						} else if (r && r.error === 'not-found') {
							setMsg({ kind: 'err', text: '用户不存在（可能已被删除）' });
							load();
						} else {
							setMsg({ kind: 'err', text: '调整角色失败，请稍后重试' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '操作失败：无法连接认证服务' });
					});
				};

				const onDelete = (username) => {
					if (busy) return;
					if (!window.confirm('确定删除用户 ' + username + ' 吗？该用户的所有会话将立即失效，此操作不可撤销。')) return;
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/users/delete', { username }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已删除用户 ' + username + '。' });
							load();
						} else if (r && r.error === 'cannot-delete-self') {
							setMsg({ kind: 'err', text: '不能删除自己的账号' });
						} else if (r && r.error === 'last-admin') {
							setMsg({ kind: 'err', text: '不能删除最后一个管理员' });
						} else if (r && r.error === 'not-found') {
							setMsg({ kind: 'err', text: '用户不存在（可能已被删除）' });
							load();
						} else {
							setMsg({ kind: 'err', text: '删除失败，请稍后重试' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '删除失败：无法连接认证服务' });
					});
				};

				const onResetPassword = (username) => {
					if (busy) return;
					const st = checkPassword(resetPass);
					if (!st.ok) { setMsg({ kind: 'err', text: st.text }); return; }
					setBusy(true);
					setMsg(null);
					api('/dsh-webui-auth/users/reset-password', { username, password: resetPass }).then((r) => {
						setBusy(false);
						if (r && r.ok) {
							setMsg({ kind: 'ok', text: '已重置 ' + username + ' 的密码，该用户所有会话已失效。' });
							setResetFor(null);
							setResetPass('');
							load();
						} else if (r && r.error === 'weak-password') {
							setMsg({ kind: 'err', text: '密码强度不足：至少 8 位，需包含大小写字母、数字和特殊符号' });
						} else if (r && r.error === 'not-found') {
							setMsg({ kind: 'err', text: '用户不存在（可能已被删除）' });
							load();
						} else {
							setMsg({ kind: 'err', text: '重置失败，请稍后重试' });
						}
					}).catch(() => {
						setBusy(false);
						setMsg({ kind: 'err', text: '重置失败：无法连接认证服务' });
					});
				};

				const createForm = react.createElement('div', { className: 'wua-row', style: { gap: '8px' } },
					react.createElement('label', { className: 'wua-label' }, '新建用户'),
					react.createElement('input', { className: 'wua-input', type: 'text', value: newName, placeholder: '用户名（3-32 位字母、数字、下划线或连字符）', spellCheck: false, onChange: (e) => setNewName(e.target.value) }),
					react.createElement('input', { className: 'wua-input', type: 'password', value: newPass, placeholder: '初始密码（至少 8 位，含大小写、数字、特殊符号）', onChange: (e) => setNewPass(e.target.value) }),
					react.createElement('div', { className: 'wua-btnrow', style: { flexWrap: 'nowrap', width: '100%' } },
						react.createElement('select', { className: 'wua-select', value: newRole, style: { flex: '1 1 auto' }, onChange: (e) => setNewRole(e.target.value) },
							react.createElement('option', { key: 'user', value: 'user' }, '普通用户'),
							react.createElement('option', { key: 'admin', value: 'admin' }, '管理员'),
						),
						react.createElement('button', { className: 'wua-btn', style: { flex: '0 0 auto' }, disabled: busy, onClick: onCreate }, busy ? '处理中…' : '新建'),
					),
				);

				let listEl;
				if (users === null) {
					listEl = react.createElement('p', { className: 'wua-intro' }, '正在读取用户列表…');
				} else if (users.length === 0) {
					listEl = react.createElement('p', { className: 'wua-intro' }, '暂无用户。');
				} else {
					listEl = react.createElement('div', { className: 'wua-users' },
						users.map((u) => react.createElement('div', { key: u.username, className: 'wua-user' },
							react.createElement('div', { className: 'wua-user-head' },
								react.createElement('span', { className: 'wua-user-name' }, u.username),
								u.nickname ? react.createElement('span', { className: 'wua-user-nick' }, '（' + u.nickname + '）') : null,
								react.createElement('div', { className: 'wua-user-role' },
									react.createElement('select', {
										className: 'wua-select',
										value: u.role,
										disabled: busy,
										onChange: (e) => onSetRole(u.username, e.target.value),
									},
										react.createElement('option', { key: 'user', value: 'user' }, '普通用户'),
										react.createElement('option', { key: 'admin', value: 'admin' }, '管理员'),
									),
								),
							),
							resetFor === u.username
								? react.createElement('div', { className: 'wua-user-actions' },
									react.createElement('div', { className: 'wua-user-reset' },
										react.createElement('input', { className: 'wua-input', type: 'password', value: resetPass, placeholder: '新密码（至少 8 位，含大小写、数字、特殊符号）', onChange: (e) => setResetPass(e.target.value) }),
										react.createElement('button', { className: 'wua-btn small', disabled: busy, onClick: () => onResetPassword(u.username) }, '确认重置'),
										react.createElement('button', { className: 'wua-btn small ghost', disabled: busy, onClick: () => { setResetFor(null); setResetPass(''); } }, '取消'),
									),
								)
								: react.createElement('div', { className: 'wua-user-actions' },
									react.createElement('button', { className: 'wua-btn small ghost', disabled: busy, onClick: () => { setResetFor(u.username); setResetPass(''); setMsg(null); } }, '重置密码'),
									react.createElement('button', { className: 'wua-btn small danger', disabled: busy, onClick: () => onDelete(u.username) }, '删除'),
								),
						)),
					);
				}

				return react.createElement('div', { className: 'wua-section' },
					react.createElement('p', { className: 'wua-intro' }, '管理登录本平台的账号：新建用户、重置密码、调整角色（管理员/普通用户）、删除用户。调整角色或重置密码后，目标用户需重新登录或会话即失效。'),
					createForm,
					msg ? react.createElement('div', { className: msg.kind === 'ok' ? 'wua-msg' : 'wua-err' }, msg.text) : null,
					listEl,
					react.createElement('p', { className: 'wua-hint' },
						'普通用户登录后看不到本页，只能在「身份认证」页修改自己的密码。管理员至少保留一个：无法删除或降级最后一个管理员，也无法删除自己的账号。'),
				);
			}

			// ---------------- 注册 ----------------
			// 身份认证页：所有登录用户都注册。
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'webui-auth',
				order: 30,
				label: '身份认证',
			}, AuthSettings));

			// 用户管理页：仅管理员注册。settings.section 是响应式列表账本，
			// 异步查完角色后再注册会触发导航重渲染；普通用户永不注册 → 导航项不出现。
			api('/dsh-webui-auth/status').then((s) => {
				if (!s || s.error || s.role !== 'admin') return;
				try {
					ctx.slots.inject('settings.section', () => ctx.slots.register({
						name: 'settings.section',
						id: 'webui-auth-users',
						order: 31,
						label: '用户管理',
					}, UserAdminSection));
				} catch (e) {
					// 插件已在查询期间卸载：注册窗口已关闭，忽略。
				}
			}).catch(() => { /* status 不可用：不注册管理页 */ });
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
