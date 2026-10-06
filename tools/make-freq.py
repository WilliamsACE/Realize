"""Genera js/freq.js: frecuencia de uso de ~100 mil palabras del inglés.

Uso:  pip install wordfreq   y luego   python tools/make-freq.py

Fuente: wordfreq (Robyn Speer et al.), github.com/rspeer/wordfreq. Datos bajo CC BY-SA 4.0.
Cada palabra se guarda en una banda de media unidad de «Zipf» (escala logarítmica: 7 = «de»,
5 = «casa», 3 = «deslumbrar», 2 = «abeyance»); lo que no está es más raro que Zipf 2.
Formato por banda: palabras ordenadas y comprimidas con prefijo compartido, separadas por espacio;
cada palabra empieza con un carácter que da cuántas letras comparte con la anterior (0-9, a-z).
"""
import json, os, re, zlib
from wordfreq import top_n_list, zipf_frequency

MIN_ZIPF = 2.0
ok = re.compile(r'^[a-z]{3,}$')
bands = {}
for w in top_n_list('en', 300000):
    if not ok.match(w):
        continue
    z = zipf_frequency(w, 'en')
    if z < MIN_ZIPF:
        break
    bands.setdefault(int(z * 2), []).append(w)

DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
def pack(words):
    out, prev = [], ''
    for w in sorted(words):
        n = 0
        while n < min(len(prev), len(w), 35) and prev[n] == w[n]:
            n += 1
        out.append(DIGITS[n] + w[n:])
        prev = w
    return ' '.join(out)

data = {str(k): pack(v) for k, v in sorted(bands.items())}
total = sum(len(v) for v in bands.values())
header = f"""/* Frecuencia de uso de {total:,} palabras del inglés (para decidir qué palabras de un texto
   vale la pena estudiar). Generado con tools/make-freq.py; no editar a mano.
   Fuente: wordfreq (Robyn Speer et al.), https://github.com/rspeer/wordfreq — datos bajo
   Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), igual que la lista de palabras comunes.
   Banda b = Zipf de b/2 a (b+1)/2; lo que no aparece es más raro que Zipf {MIN_ZIPF}. */
"""
body = 'window.WORD_FREQ = ' + json.dumps({'min': MIN_ZIPF, 'bands': data}, separators=(',', ':')) + ';\n'
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'freq.js')
open(path, 'w', encoding='utf-8', newline='\n').write(header + body)
raw = (header + body).encode()
print(f'{total} palabras · {len(raw)/1024:.0f} KB · gzip {len(zlib.compress(raw, 9))/1024:.0f} KB')
