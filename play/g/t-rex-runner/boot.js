// Replaces the inline scripts that were in index.html (this origin's CSP blocks inline scripts). The start message
// hides on Space, a tap or a click, and a left click jumps, so the game works without a keyboard. A phone fires a
// mousedown after each tap, so a mousedown right after a touch is left to the game's own touch handling.
(function () {
    var box = document.getElementById('messageBox');
    var lastTouch = 0;
    function hide() {
        if (box) box.style.visibility = 'hidden';
    }
    document.addEventListener('keydown', function (e) {
        if (e.keyCode == 32 || e.keyCode == 38) hide();
    });
    document.addEventListener('touchstart', function () {
        lastTouch = Date.now();
        hide();
    }, { passive: true });
    document.addEventListener('mousedown', function (e) {
        hide();
        var runner = window.Runner && window.Runner.instance_;
        if (!runner || e.button !== 0 || Date.now() - lastTouch < 800) return;
        if (runner.crashed) {
            // Without touch, the game restarts on a click itself; with a touch screen it only listens for taps.
            // runner.time is Date.now() on iOS and performance.now() elsewhere.
            var now = runner.time > 1e12 ? Date.now() : performance.now();
            if (runner.touchController && now - runner.time >= runner.config.GAMEOVER_CLEAR_TIME) runner.restart();
            return;
        }
        runner.onKeyDown({ keyCode: 32, type: 'keydown', target: e.target, preventDefault: function () {} });
    });
})();
