// Shared logic for index.html (web) and embed.html (Homarr widget).
//
// The container comes from ?c=<name>. nginx only lets allowlisted names
// through (see ../nginx.conf), so an unknown name shows as "not allowed".
//
// Pages provide: #toggle (button), #state (label). Optional: #name, #detail.
// The button's data-state attribute drives the styling:
//   running | stopped | busy | other | error

(function () {
    const POLL_MS = 5000;
    const params = new URLSearchParams(location.search);
    const ctr = (params.get('c') || '').trim();

    const btn = document.getElementById('toggle');
    const stateEl = document.getElementById('state');
    const nameEl = document.getElementById('name');
    const detailEl = document.getElementById('detail');

    let current = null;   // last Docker state: running, exited, created, paused, ...
    let busy = false;
    let timer = null;

    if (nameEl) nameEl.textContent = ctr || 'no container';
    if (ctr) document.title = ctr + ' · homelabctl';

    function render(kind, label, detail) {
        btn.dataset.state = kind;
        stateEl.textContent = label;
        if (detailEl) detailEl.textContent = detail || '';
        const action = kind === 'running' ? 'Stop' : kind === 'stopped' ? 'Start' : '';
        btn.disabled = !action;
        btn.title = action ? action + ' ' + ctr : label;
        btn.setAttribute('aria-label', btn.title);
    }

    async function refresh() {
        if (busy) return;
        try {
            const res = await fetch('/docker/' + encodeURIComponent(ctr) + '/state', { cache: 'no-store' });
            if (res.status === 403) return render('error', 'not allowed', 'Add it to $ctr_allowed in nginx.conf');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const list = await res.json();
            if (!list.length) return render('error', 'not found', 'No container named ' + ctr);
            current = list[0].State;
            const status = list[0].Status;   // e.g. "Up 3 hours", "Exited (0) 2 days ago"
            if (current === 'running') render('running', 'running', status);
            else if (current === 'exited' || current === 'created' || current === 'dead') render('stopped', 'stopped', status);
            else render('other', current, status);
        } catch (err) {
            render('error', 'offline', err.message);
        }
    }

    async function toggle() {
        if (busy || btn.disabled) return;
        const act = current === 'running' ? 'stop' : 'start';
        busy = true;
        render('busy', act === 'stop' ? 'stopping…' : 'starting…');
        try {
            const res = await fetch('/docker/' + encodeURIComponent(ctr) + '/' + act, { method: 'POST' });
            // 204 = done, 304 = already in that state
            if (res.status !== 204 && res.status !== 304) {
                let msg = 'HTTP ' + res.status;
                try { msg = (await res.json()).message || msg; } catch (_) {}
                throw new Error(msg);
            }
        } catch (err) {
            busy = false;
            render('error', act + ' failed', err.message);
            setTimeout(refresh, 3000);
            return;
        }
        busy = false;
        refresh();
    }

    function schedule() {
        clearInterval(timer);
        timer = setInterval(refresh, POLL_MS);
    }

    if (!ctr) {
        render('error', 'no container', 'Add ?c=<container> to the URL');
        return;
    }

    btn.addEventListener('click', toggle);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearInterval(timer); }
        else { refresh(); schedule(); }
    });

    refresh();
    schedule();
})();
