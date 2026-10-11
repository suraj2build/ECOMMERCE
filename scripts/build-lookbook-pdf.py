"""Build the complete preview edition from the same manifest as the reader.

Requires Python Pillow + reportlab. Run from the repository root. Set
LOOKBOOK_SITE_URL to the actual preview/public storefront before publishing.
"""
import json
import io
import os
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/storefront/public'
ISSUE = json.loads((ROOT / 'apps/storefront/src/content/lookbook-issue-01.json').read_text())
OUT = PUBLIC / ISSUE['pdf'].lstrip('/')
OUT.parent.mkdir(parents=True, exist_ok=True)
SITE = os.getenv('LOOKBOOK_SITE_URL', 'http://localhost:3000').rstrip('/')
URL = SITE + '/women/lookbook/issues/' + ISSUE['slug']
W, H = 595, 744
INK, PAPER, MUTED = '#292820', '#faf7f2', '#78695b'
fonts = Path('/usr/share/fonts/truetype/dejavu')
pdfmetrics.registerFont(TTFont('Body', str(fonts / 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('Bold', str(fonts / 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFont(TTFont('Editorial', str(fonts / 'DejaVuSerif.ttf')))
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
c.setTitle(ISSUE['title'] + ' - Complete Lookbook 01')
c.setAuthor('The Lookbook / Preview Collection')
c.setSubject('Twelve complete looks: Riya, Deeksha and Heena')

def text(value, x, y, size=11, font='Body', colour=INK):
    c.setFillColor(HexColor(colour)); c.setFont(font, size); c.drawString(x, y, value)

def para(value, x, top, width, size=12, leading=21, colour=INK):
    p = Paragraph(escape(value), ParagraphStyle('p', fontName='Body', fontSize=size, leading=leading, textColor=HexColor(colour)))
    _, height = p.wrap(width, H)
    p.drawOn(c, x, top-height)
    return height

def photo(asset, x, y, width, height, fill=False):
    im = Image.open(PUBLIC / asset.lstrip('/')).convert('RGB')
    im.thumbnail((1800, 2250), Image.Resampling.LANCZOS)
    iw, ih = im.size
    scale = max(width/iw, height/ih) if fill else min(width/iw, height/ih)
    dw, dh = iw*scale, ih*scale
    c.saveState()
    clip = c.beginPath(); clip.rect(x, y, width, height); c.clipPath(clip, stroke=0)
    encoded = io.BytesIO()
    im.save(encoded, format='JPEG', quality=91, optimize=True)
    encoded.seek(0)
    c.drawImage(ImageReader(encoded), x+(width-dw)/2, y+(height-dh)/2, dw, dh)
    c.restoreState()

def begin(number, background=PAPER):
    c.bookmarkPage('p' + str(number))
    c.setFillColor(HexColor(background)); c.rect(0, 0, W, H, fill=1, stroke=0)
    if number not in (1,32):
        text('THE LOOKBOOK / WOMEN / EDITION 01', 42, H-32, 8, colour=MUTED)
        text(str(number).zfill(2), W-59, 25, 9, colour=MUTED)

def link(label, page, x, y, size=11):
    text(label, x, y, size)
    c.linkRect('', 'p'+str(page), (x,y-4,x+pdfmetrics.stringWidth(label,'Body',size),y+size+3), relative=0, thickness=0)

begin(1); photo(ISSUE['cover'],0,0,W,H,True)
text('THE LOOKBOOK / WOMEN / 01',42,H-45,10,'Bold')
text('A city.',42,H-115,38,'Editorial');text('Three',42,H-166,38,'Editorial');text('moods.',42,H-217,38,'Editorial')
text('Twelve looks. One changing rhythm.',42,55,11,'Bold')
c.linkURL(URL,(0,0,W,H),relative=0,thickness=0);c.showPage()

begin(2);text('A NOTE FROM THE EDITION',42,650,9,'Bold',MUTED)
text('Dress for',42,570,40,'Editorial');text('the moment.',42,518,40,'Editorial')
height=para(ISSUE['intro'],42,460,445,14,26)
para('A collection is more than separate pieces. It is how they come together - and the moments you make in them.',42,430-height,445,13,24)
text('MORNING / AFTERNOON / EVENING',42,85,9,'Bold',MUTED);c.showPage()

begin(3);text('Inside this edition',42,640,32,'Editorial')
for i,ch in enumerate(ISSUE['chapters']):
    y=535-i*140
    text(f'0{i+1} / {ch["model"].upper()}',42,y,10,'Bold',MUTED)
    link(ch['title'],ch['start'],42,y-39,22)
    text(f'{len(ch["lookIds"])} complete looks / page {ch["start"]}',42,y-67,11)
link('Find every look / page 31',31,42,90);c.showPage()

number=4
looks={l['id']:l for l in ISSUE['looks']}
page_for={}
for ch in ISSUE['chapters']:
    begin(number,'#ebe1d4');text(ch['model'].upper(),42,650,10,'Bold',MUTED)
    text(ch['title'],42,590,34,'Editorial')
    para(ch['intro'],42,550,465,13,23)
    photo(looks[ch['lookIds'][0]]['image'],42,70,511,380)
    c.showPage();number+=1
    for lid in ch['lookIds']:
        l=looks[lid];page_for[lid]=number
        begin(number)
        text(f'LOOK {lid} / {l["model"].upper()}',42,685,9,'Bold',MUTED)
        photo(l['image'],42,143,511,526)
        text(l['title'],42,111,25,'Editorial')
        para(l['caption'],42,86,475,10,17)
        c.showPage();number+=1
        begin(number)
        text(f'LOOK {lid} / THE PIECES',42,685,9,'Bold',MUTED)
        text(l['title'],42,645,26,'Editorial')
        products=l['products']
        for i,p in enumerate(products):
            x=42+i*263
            photo(p['front'],x,324,248,286)
            text(p['title'],x,300,10,'Bold')
            text(p['colourName'],x,281,9,colour=MUTED)
            photo(p['detail'],x,131,248,126)
        if len(products)==1:
            p=products[0];photo(p['detail'],305,324,248,286)
            text('Fabric & construction',305,300,10,'Bold')
        text('SHOP THIS LOOK ONLINE',42,104,9,'Bold')
        para('Choose each size and see current price and stock in the book reader. Shoes, jewellery and bags may be styling only.',42,84,490,9,15)
        c.linkURL(URL+'#page='+str(number),(42,92,260,119),relative=0,thickness=0)
        c.showPage();number+=1

assert number==31
begin(31);text('Find your moment',42,650,32,'Editorial')
for i,l in enumerate(ISSUE['looks']):
    x=42+(i%3)*173;y=470-(i//3)*127
    photo(l['image'],x,y,154,105)
    label=f'{l["id"]} / {l["title"]}'
    text(label,x,y-17,8,'Bold')
    c.linkRect('', 'p'+str(page_for[l['id']]),(x,y-24,x+154,y+105),relative=0,thickness=0)
c.showPage()
begin(32,INK)
text('THE LOOKBOOK / WOMEN / 01',42,690,9,'Bold',PAPER)
text('Keep your',42,510,40,'Editorial',PAPER);text('own rhythm.',42,457,40,'Editorial',PAPER)
text('Riya. Deeksha. Heena.',42,395,14,colour=PAPER)
para('One city, seen three ways.',42,365,450,12,22,PAPER)
para('AI-generated editorial and catalogue imagery for the preview collection. Garments follow the referenced catalogue masters. Product availability is confirmed online. Accessories may be styling only.',42,165,480,10,18,PAPER)
text('Read and shop the complete edition online',42,52,10,colour=PAPER)
c.linkURL(URL,(42,45,400,70),relative=0,thickness=0)
c.save()
print(str(OUT))
