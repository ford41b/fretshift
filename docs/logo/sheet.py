import sys,re
files=sys.argv[1:]
def inner(f):
    s=open(f).read(); return re.sub(r'<title>.*?</title>','',s)
rows=""
for f in files:
    s=inner(f)
    col=s.replace('fill="#000"','fill="#fff"')
    icon=f'<div class="ic" style="background:#6B4EFF">'+col.replace('viewBox="0 0 256 256"','viewBox="-60 -60 376 376"')+'</div>'
    rows+=f'''<div class="row"><div class="lbl">{f}</div>
    <div class="big">{s}</div><div class="big inv">{col}</div><div class="big">{icon}</div>
    <div class="sm"><div style="width:64px;height:64px">{icon}</div><div style="width:32px;height:32px">{icon}</div><div style="width:16px;height:16px">{icon}</div><div style="width:16px;height:16px">{s}</div></div></div>'''
open('sheet.html','w').write(f'''<html><body style="margin:0;font:14px sans-serif;background:#fff">
<style>.row{{display:flex;align-items:center;gap:24px;padding:20px}}.lbl{{width:130px}}.big{{width:220px;height:220px}}.inv{{background:#111}}
.big svg,.sm svg{{width:100%;height:100%;display:block}}.ic{{width:100%;height:100%;border-radius:22%;overflow:hidden}}.sm{{display:flex;gap:16px;align-items:center}}</style>{rows}</body></html>''')
