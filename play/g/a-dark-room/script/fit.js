// arctanmyangle-play: the game is laid out in fixed pixels, so on a screen narrower than it (a phone, or the frame on
// arctanmyangle.pages.dev) the whole page is scaled to fit the width instead of being cut off. css/phone.css narrows
// the layout to 720px first.
(function () {
	function fit() {
		var need = window.innerWidth >= 940 ? 940 : 720;
		var scale = Math.min(1, window.innerWidth / need);
		document.documentElement.style.zoom = scale < 1 ? String(scale) : '';
	}
	fit();
	window.addEventListener('resize', fit);
})();
