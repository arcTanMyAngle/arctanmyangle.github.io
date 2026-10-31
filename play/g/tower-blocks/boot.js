// Moved out of index.html, which this origin's CSP keeps free of inline scripts. The share button and the
// WeChat share overlay are gone; the error alert is shown in the loading text instead.
var domReady, loadFinish, canvasReady, loadError, gameStart, game, score, successCount
  // init window height and width
  var gameWidth = window.innerWidth
  var gameHeight = window.innerHeight
  var ratio = 1.5
  if (gameHeight / gameWidth < ratio) {
    gameWidth = Math.ceil(gameHeight / ratio)
  }
  $('.content').css({ "height": gameHeight + "px", "width": gameWidth + "px" })
  $('.js-modal-content').css({ "width": gameWidth + "px" })

  // loading animation
  function hideLoading() {
    if (domReady && canvasReady) {
      $('#canvas').show()
      loadFinish = true
      setTimeout(function () {
        $('.loading').hide()
        $('.landing').show()
      }, 1000)
    }
  }

  function updateLoading(status) {
    var success = status.success
    var total = status.total
    var failed = status.failed
    if (failed > 0 && !loadError) {
      loadError = true
      $('.loading .text').text('Network error. Reload to try again.')
      return
    }
    var percent = parseInt((success / total) * 100);
    if (percent === 100 && !canvasReady) {
      canvasReady = true
      hideLoading()
    }
    percent = percent > 98 ? 98 : percent
    percent = percent + '%'
    $('.loading .title').text(percent);
    $('.loading .percent').css({
      'width': percent
    })
  }

  function overShowOver() {
    $('#modal').show()
    $('#over-modal').show()
    $('#over-zero').show()
  }

  // game customization options
  const option = {
    width: gameWidth,
    height: gameHeight,
    canvasId: 'canvas',
    soundOn: true,
    setGameScore: function (s) {
      score = s
    },
    setGameSuccess: function (s) {
      successCount = s
    },
    setGameFailed: function (f) {
      $('#score').text(score)
      if (f >= 3) overShowOver()
    }
  }

  // game init with option
  function gameReady() {
    game = TowerGame(option)
    game.load(function () {
      game.init()
      setTimeout(function () {
        game.playBgm()
      })
    }, updateLoading)
  }

  var isWechat = navigator.userAgent.toLowerCase().indexOf("micromessenger") !== -1
  if (isWechat) {
    document.addEventListener("WeixinJSBridgeReady", gameReady, false)
  } else {
    gameReady()
  }

  function indexHide() {
    $('.landing .action-1').addClass('slideTop')
    $('.landing .action-2').addClass('slideBottom')
    setTimeout(function () {
      $('.landing').hide()
    }, 950)
  }

  // click event
  $('#start').on('click', function () {
    if (gameStart) return
    gameStart = true
    setTimeout(function () {
      game.playBgm()
    })
    indexHide()
    setTimeout(game.start, 400)
  })

  $('.js-reload').on('click', function () {
    window.location.reload()
  })

  // The game listens only for touch events on a device with a touch screen, so a mouse on a touch-screen computer
  // did nothing. Pass a mouse press through as a touch there. A phone fires a mousedown after each tap, so one right
  // after a real touch is skipped, and so are clicks on the buttons.
  if ('ontouchstart' in window) {
    var lastTouch = 0
    document.addEventListener('touchstart', function (e) {
      if (e.isTrusted) lastTouch = Date.now()
    }, true)
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || Date.now() - lastTouch < 800 || $(e.target).closest('a, button, #start, .js-reload').length) return
      document.dispatchEvent(new Event('touchstart', { bubbles: true }))
    })
    document.addEventListener('mouseup', function (e) {
      if (e.button !== 0 || Date.now() - lastTouch < 800) return
      document.dispatchEvent(new Event('touchend', { bubbles: true }))
    })
  }

  // listener
  window.addEventListener('load', function () {
    domReady = true
    hideLoading()
  }, false);
