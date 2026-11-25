// In-sim toolbar panel. Finds the desktop app on localhost and shows its display.
// Plain XHR: Coherent GT has no fetch. One port at a time so a closed port cannot stall the sim.
var FH_PORT = 47321;
var FH_RETRY_MS = 5000;

function fhAsk(cb) {
    var done = false;
    var xhr = null;
    var finish = function (ok) {
        if (done) return;
        done = true;
        cb(ok);
    };
    try {
        xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            var ok = false;
            if (xhr.status === 200) {
                try {
                    var j = JSON.parse(xhr.responseText);
                    ok = !!j && j.app === 'Flap Happy';
                } catch (e) { ok = false; }
            }
            finish(ok);
        };
        xhr.onerror = function () { finish(false); };
        xhr.ontimeout = function () { finish(false); };
        xhr.open('GET', 'http://127.0.0.1:' + FH_PORT + '/version?t=' + Date.now(), true);
        xhr.timeout = 1500;
        xhr.send();
    } catch (e) {
        finish(false);
    }
    setTimeout(function () {
        if (done) return;
        try { if (xhr) xhr.abort(); } catch (e2) { }
        finish(false);
    }, 2500);
}

function fhNote(panel, show) {
    var note = panel._fhNote || document.getElementById('FlapHappyNote');
    panel._fhNote = note;
    if (!note) return;
    note.style.display = show ? 'block' : 'none';
}

function fhConnect(panel) {
    panel._fhGen = (panel._fhGen || 0) + 1;
    if (panel._fhTimer) clearTimeout(panel._fhTimer);
    var gen = panel._fhGen;
    var attempt = function () {
        fhAsk(function (ok) {
            if (!panel.panelActive || panel._fhGen !== gen || !panel.iframeElement) return;
            if (ok) {
                fhNote(panel, false);
                if (!panel._fhLoaded) {
                    panel._fhLoaded = true;
                    panel.iframeElement.src = 'http://127.0.0.1:' + FH_PORT + '/panel.html?t=' + Date.now();
                }
                return;
            }
            panel._fhLoaded = false;
            fhNote(panel, true);
            panel._fhTimer = setTimeout(attempt, FH_RETRY_MS);
        });
    };
    attempt();
}

function fhDisconnect(panel) {
    panel._fhGen = (panel._fhGen || 0) + 1;
    panel._fhLoaded = false;
    if (panel._fhTimer) clearTimeout(panel._fhTimer);
    panel._fhTimer = null;
    fhNote(panel, false);
}

// MSFS 2024 Camera Variables: 2 cockpit; 3 chase, 4 fixed on plane,
// 5 environment, 7 showcase, 8 drone. The SDK describes 9 inconsistently
// (Waiting in the table, showcase selector in prose); 6 Gameplay is not a
// named external view. Leave both visible until verified in the simulator.
var FH_EXTERNAL_CAMERA = { chase: 3, fixed: 4, environment: 5, showcase: 7, drone: 8 };
function fhIsExternalCamera(state) {
    return typeof state === 'number' && Object.keys(FH_EXTERNAL_CAMERA).some(function (name) { return FH_EXTERNAL_CAMERA[name] === state; });
}
function fhReadCamera() {
    var sim = window.SimVar;
    if (!sim || typeof sim.GetSimVarValue !== 'function') return null;
    try {
        if (typeof sim.IsReady === 'function' && !sim.IsReady()) return null;
        var raw = sim.GetSimVarValue('CAMERA STATE', 'Enum');
        return typeof raw === 'number' && isFinite(raw) && Math.floor(raw) === raw && raw > 0 ? raw : null;
    } catch (e) { return null; }
}
function fhCameraVisibility(panel) {
    var hidden = panel.panelActive && panel._fhAutoHide === true && fhIsExternalCamera(fhReadCamera());
    if (panel.ingameUi) panel.ingameUi.classList.toggle('fh-external-hidden', hidden);
}
function fhReadPanelSettings(panel, generation) {
    if (panel._fhSettingsRequest) return;
    var xhr;
    try {
        xhr = new XMLHttpRequest();
        panel._fhSettingsRequest = xhr;
        var finish = function () {
            if (panel._fhSettingsRequest !== xhr) return;
            panel._fhSettingsRequest = null;
            if (!panel.panelActive || generation !== panel._fhCameraGeneration) return;
            // An unavailable app does not cancel an explicit preference. Camera
            // checks remain independent, so cockpit return still restores it.
            if (xhr.status === 200) try {
                var payload = JSON.parse(xhr.responseText);
                if (typeof payload.autoHideExternal === 'boolean') panel._fhAutoHide = payload.autoHideExternal;
            } catch (e) { }
            fhCameraVisibility(panel);
        };
        xhr.open('GET', 'http://127.0.0.1:' + FH_PORT + '/panel-settings', true);
        xhr.timeout = 1500;
        xhr.onreadystatechange = function () { if (xhr.readyState === 4) finish(); };
        xhr.onerror = xhr.ontimeout = finish;
        xhr.send();
    } catch (e) { panel._fhSettingsRequest = null; }
}
function fhStartCamera(panel) {
    fhStopCamera(panel);
    var generation = panel._fhCameraGeneration;
    panel._fhAutoHide = false;
    fhReadPanelSettings(panel, generation);
    panel._fhCameraTimer = setInterval(function () { fhCameraVisibility(panel); }, 200);
    panel._fhSettingsTimer = setInterval(function () { fhReadPanelSettings(panel, generation); }, 1000);
}
function fhStopCamera(panel) {
    panel._fhCameraGeneration = (panel._fhCameraGeneration || 0) + 1;
    if (panel._fhCameraTimer) clearInterval(panel._fhCameraTimer);
    if (panel._fhSettingsTimer) clearInterval(panel._fhSettingsTimer);
    panel._fhCameraTimer = panel._fhSettingsTimer = null;
    var request = panel._fhSettingsRequest;
    panel._fhSettingsRequest = null;
    if (request) try { request.abort(); } catch (e) { }
    if (panel.ingameUi) panel.ingameUi.classList.remove('fh-external-hidden');
}

class IngamePanelFlapHappy extends TemplateElement {
    constructor() {
        super();
        this.panelActive = false;
        this.ingameUi = null;
        this.iframeElement = null;
        this.initialize();
    }
    connectedCallback() {
        super.connectedCallback();
        var self = this;
        this.ingameUi = this.querySelector('ingame-ui');
        this.iframeElement = document.getElementById('FlapHappyFrame');
        if (!this.ingameUi || this._fhActive) return;
        this._fhActive = function () {
            self.panelActive = true;
            fhConnect(self);
            fhStartCamera(self);
        };
        this._fhInactive = function () {
            self.panelActive = false;
            fhStopCamera(self);
            fhDisconnect(self);
            if (self.iframeElement) self.iframeElement.src = '';
        };
        this.ingameUi.addEventListener('panelActive', this._fhActive);
        this.ingameUi.addEventListener('panelInactive', this._fhInactive);
    }
    initialize() {
        document.body.classList.add('interact');
    }
    disconnectedCallback() {
        this.panelActive = false;
        fhStopCamera(this);
        fhDisconnect(this);
        if (this.ingameUi) {
            this.ingameUi.removeEventListener('panelActive', this._fhActive);
            this.ingameUi.removeEventListener('panelInactive', this._fhInactive);
        }
        this._fhActive = this._fhInactive = null;
        super.disconnectedCallback();
    }
}
window.customElements.define('flaphappy-ingamepanel', IngamePanelFlapHappy);
checkAutoload();
