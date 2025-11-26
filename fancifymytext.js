


function makeBigger() { 
	alert("Hello, world!");
	document.getElementById("textArea").style.fontSize = "24pt";
}


function changeStyle() {

    var textArea = document.getElementById("textArea");
    var fancyRadio = document.getElementById("fancyShmancy");
    
    if (fancyRadio.checked) {

        textArea.style.fontWeight = "bold";
        textArea.style.color = "blue";
        textArea.style.textDecoration = "underline";
    } else {

        textArea.style.fontWeight = "normal";
        textArea.style.color = "black";
        textArea.style.textDecoration = "none";
    }
}

function mooText() {

    var textArea = document.getElementById("textArea");
    var text = textArea.value;
    text = text.toUpperCase();
    var sentences = text.split(".");
    
    for (var i = 0; i < sentences.length; i++) {
   
        if (sentences[i].trim() !== "") { sentences[i] = sentences[i] + "-Moo";}
    }

    text = sentences.join(".");
    textArea.value = text;
}