importScripts('deflate.js');

var crc32 = (function () {
	var table = new Uint32Array(256);
	for (var i = 0; i < 256; i++) {
		var c = i;
		for (var k = 0; k < 8; k++)
			c = (c & 1 > 0) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c;
	}
	
	return function (crc) {
		for (var j = 1; j < arguments.length; j++)
			for (var i = 0; i < arguments[j].length; i++)
				crc = table[(crc ^ arguments[j][i]) & 0xFF] ^ (crc >>> 8);
		return ~crc;
	};
}());

function adler32(array, param) {
	var adler = 1;
    var s1 = adler & 0xffff,
        s2 = (adler >>> 16) & 0xffff;
    var len = array.length;
    var tlen;
    var i = 0;

    while (len > 0) {
      tlen = len > param ? param : len;
      len -= tlen;
      do {
        s1 += array[i++];
        s2 += s1;
      } while (--tlen);

      s1 %= 65521;
      s2 %= 65521;
    }

    return ((s2 << 16) | s1) >>> 0;
}

function PNG(data, width, height) {
	data = new Uint8ClampedArray(data);
	
	// Generate a color palette and IDAT block
	var size = data.length;
	var i = 0;
	var palette = {};
	var paletteColors = new Uint8Array(255*3);
	var paletteColorsPointer = 0;
	var idatPalette = new Uint8Array(size / 4 + height);
	var idatPalettePointer = 0;
	var idatTruecolor = new Uint8Array(size / 4 * 3 + height);
	var idatTruecolorPointer = 0;
	for (var y = 0; y < height; y++) {

		// No filter at the start of each row
		if (paletteColorsPointer < 255)
			idatPalette[idatPalettePointer++] = 0;
		idatTruecolor[idatTruecolorPointer++] = 0;
	
		for (var x = 0; x < width; x++) {
	
			// Convert RGBA to RGB
			var a = data[i + 3] / 255;
			var r = data[i] * a + 255 * (1 - a); //255 - a * data[i] / 255;
			var g = data[i + 1] * a + 255 * (1 - a); //255 - a * data[i + 1] / 255;
			var b = data[i + 2] * a + 255 * (1 - a); //255 - a * data[i + 2] / 255;
			i += 4;
		
			if (paletteColorsPointer < 255) {
				var color = r << 16 | g << 8 | b;
				if (!(color in palette)) {
					paletteColors[paletteColorsPointer * 3] = r;
					paletteColors[paletteColorsPointer * 3 + 1] = g;
					paletteColors[paletteColorsPointer * 3 + 2] = b;
					palette[color] = paletteColorsPointer++;
				}
				idatPalette[idatPalettePointer++] = palette[color];
			}
			
			idatTruecolor[idatTruecolorPointer++] = r;
			idatTruecolor[idatTruecolorPointer++] = g;
			idatTruecolor[idatTruecolorPointer++] = b;
		
		}
	};

	var png = [];
	
	// The signature
	png.push((new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).buffer);
	
	function createChunk(name, data) {
		var size = new Uint8Array(4);
		writeInt32(size, 0, data.length);
		
		var head = new Uint8Array(4);
		head[0] = name.charCodeAt(0);
		head[1] = name.charCodeAt(1);
		head[2] = name.charCodeAt(2);
		head[3] = name.charCodeAt(3);
			
		var tail = new Uint8Array(4);
		writeInt32(tail, 0, crc32(0xFFFFFFFF, head, data));
		
		png.push(size.buffer);
		png.push(head.buffer);
		png.push(data.buffer);
		png.push(tail.buffer);
	}
	function writeInt32(arr, i, value) {
		arr[i]     = value >>> 24;
		arr[i + 1] = value >>> 16;
		arr[i + 2] = value >>> 8;
		arr[i + 3] = value;
	}
	
	// The header (IHDR)
	var ihdr = new Uint8Array(13);
	writeInt32(ihdr, 0, width);
	writeInt32(ihdr, 4, height);
	ihdr[8] = 8;//paletteColorsPointer < 255 ? Math.pow(2, Math.ceil(Math.log(Math.log(paletteColorsPointer) / Math.LN2) / Math.LN2)) : 8; // Bit-depth
	ihdr[9] = paletteColorsPointer < 255 ? 3 : 2; // Colortype
	ihdr[10] = 0; // Compression
	ihdr[11] = 0; // Filter
	ihdr[12] = 0; // Interface
	createChunk('IHDR', ihdr);
	
	// The palette and data
	if (paletteColorsPointer < 255) {
		createChunk('PLTE', new Uint8Array(paletteColors.buffer.slice(0, paletteColorsPointer * 3)));
		var idat = idatPalette;
	} else {
		var idat = idatTruecolor;
	}
	
	// Write the IDAT block
	var deflater = new Deflater(9);
	var a = deflater.append(idat);
	var b = deflater.flush();
	
	var arr = new Uint8Array(a.length + b.length + 4);
	arr.set(a);
	arr.set(b, a.length);
	
	writeInt32(arr, a.length + b.length, adler32(idat));
	createChunk('IDAT', arr);
	
	createChunk('IEND', new Uint8Array(0));
	return new Blob(png, {'type': 'image/png'});
}

var queue = [];
self.onmessage = function (e) {
	queue.push(e.data);
};

// Start the loop
var reader = new FileReaderSync();
(function () {
	if (queue.length) {
		var png = reader.readAsArrayBuffer(PNG(queue.shift(), 900, 600));
		self.webkitPostMessage(png, [png]);
	}
	setTimeout(arguments.callee, 100);
}());
