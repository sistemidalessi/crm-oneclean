'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fotos.js');

test('código do FKN no nome do arquivo da foto', () => {
  assert.equal(F.codigoDoArquivo('010049.jpg'), '010049');
  assert.equal(F.codigoDoArquivo('010049.0.png'), '010049');
  assert.equal(F.codigoDoArquivo('010049 - DETERGENTE 5 LTS.jpeg'), '010049');
  assert.equal(F.codigoDoArquivo('Cod 370102 saco preto.webp'), '370102');
  assert.equal(F.codigoDoArquivo('IMG_2024.JPG'), '2024'); // número qualquer também vale: o produto precisa existir com esse código
  assert.equal(F.codigoDoArquivo('detergente.jpg'), null);
  assert.equal(F.codigoDoArquivo('foto 12.jpg'), null);
});

test('mesmo código com ou sem ".0" do FKN', () => {
  assert.equal(F.mesmoCodigo('010049.0', '010049'), true);
  assert.equal(F.mesmoCodigo('010049', '10049'), false);
  assert.equal(F.mesmoCodigo(null, '010049'), false);
});
