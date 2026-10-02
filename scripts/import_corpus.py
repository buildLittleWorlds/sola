"""Rebuild the fixed corpus offline, with source-to-output coverage assertions.

Inputs are retained upstream archives; this command never fetches newer text.
Each UXLC w/q and SBLGNT w is one recall word. Ketiv is retained as a variant,
not duplicated in the reading stream. Standalone ketiv is written but not read.
"""
from pathlib import Path
import collections
import hashlib
import json
import re
import tarfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'corpus'
OUT.mkdir(parents=True, exist_ok=True)
LICENSES = ROOT / 'public' / 'licenses'
LICENSES.mkdir(exist_ok=True)
OT = [('GEN','Genesis'),('EXO','Exodus'),('LEV','Leviticus'),('NUM','Numbers'),('DEU','Deuteronomy'),('JOS','Joshua'),('JDG','Judges'),('RUT','Ruth'),('1SA','1 Samuel'),('2SA','2 Samuel'),('1KI','1 Kings'),('2KI','2 Kings'),('1CH','1 Chronicles'),('2CH','2 Chronicles'),('EZR','Ezra'),('NEH','Nehemiah'),('EST','Esther'),('JOB','Job'),('PSA','Psalms'),('PRO','Proverbs'),('ECC','Ecclesiastes'),('SNG','Song of Songs'),('ISA','Isaiah'),('JER','Jeremiah'),('LAM','Lamentations'),('EZK','Ezekiel'),('DAN','Daniel'),('HOS','Hosea'),('JOL','Joel'),('AMO','Amos'),('OBA','Obadiah'),('JON','Jonah'),('MIC','Micah'),('NAM','Nahum'),('HAB','Habakkuk'),('ZEP','Zephaniah'),('HAG','Haggai'),('ZEC','Zechariah'),('MAL','Malachi')]
NT = [('MAT','Matthew','Matt',28),('MRK','Mark','Mark',16),('LUK','Luke','Luke',24),('JHN','John','John',21),('ACT','Acts','Acts',28),('ROM','Romans','Rom',16),('1CO','1 Corinthians','1Cor',16),('2CO','2 Corinthians','2Cor',13),('GAL','Galatians','Gal',6),('EPH','Ephesians','Eph',6),('PHP','Philippians','Phil',4),('COL','Colossians','Col',4),('1TH','1 Thessalonians','1Thess',5),('2TH','2 Thessalonians','2Thess',3),('1TI','1 Timothy','1Tim',6),('2TI','2 Timothy','2Tim',4),('TIT','Titus','Titus',3),('PHM','Philemon','Phlm',1),('HEB','Hebrews','Heb',13),('JAS','James','Jas',5),('1PE','1 Peter','1Pet',5),('2PE','2 Peter','2Pet',3),('1JN','1 John','1John',5),('2JN','2 John','2John',1),('3JN','3 John','3John',1),('JUD','Jude','Jude',1),('REV','Revelation','Rev',22)]

def digest(data): return hashlib.sha256(data).hexdigest()
def dump(path, data): path.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':'))+'\n')

def hebrew_text(element):
    # x is a transcription note code, not a Hebrew character. s marks a special
    # letter; its text belongs to the Bible. Always keep tails (vowel marks).
    return (element.text or '') + ''.join(('' if c.tag == 'x' else hebrew_text(c)) + (c.tail or '') for c in element)

books=[]
chapters=[]
stats=collections.Counter()
source_hashes={}
z=zipfile.ZipFile(ROOT/'sources/uxlc/Tanach.xml.zip')
ziphash=digest((ROOT/'sources/uxlc/Tanach.xml.zip').read_bytes())
assert ziphash == '1bc6e006f43d3b18f2f718cefa3aa4774cac2c54092c28d173dd61996c43a050', 'Unexpected Hebrew archive'
index=ET.fromstring(z.read('Books/TanachIndex.xml'))
index_books={b.findtext('names/name'):b for b in index.findall('./tanach/book')}
header=ET.fromstring(z.read('Books/TanachHeader.xml'))
version=header.findtext('.//edition/version')
assert version == 'UXLC 2.5'
# Distribute the license text, not the copyrighted site styling or other assets.
license_html=z.read('License.html').decode()
license_text=re.sub('<[^>]*>', '', license_html)
(LICENSES/'UXLC.txt').write_text(license_text)

def finish_book(book, data):
    for ch in data:
        assert ch['tokens'], ch['id']
        keys=[(t['verse'],t['sourceIndex']) for t in ch['tokens']]
        assert len(keys)==len(set(keys)), f'Duplicate token {ch["id"]}'
        chapter_meta={k:ch[k] for k in ['id','bookId','number']}
        chapter_meta.update(wordCount=len(ch['tokens']), verseCount=len(ch['verses']))
        # Stable endpoint IDs for strict backup validation without fetching books.
        chapter_meta['tokenKeys']=[f'{v}:{i}' for v,i in keys]
        chapters.append(chapter_meta)
    dump(OUT/f'{book["id"]}.json',data)
    book['chapters']=len(data)
    book['words']=sum(len(ch['tokens']) for ch in data)
    books.append(book)

for bid,name in OT:
    meta=index_books[name]
    filename='Books/'+meta.findtext('names/filename')+'.xml'
    raw=z.read(filename);source_hashes[filename]=digest(raw)
    root=ET.fromstring(raw)
    source_book=root.find('./tanach/book')
    data=[]
    for c in source_book.findall('c'):
        cn=int(c.attrib['n']);cid=f'{bid}.{cn}'
        ch={'id':cid,'bookId':bid,'number':cn,'tokens':[],'verses':[],'variants':[],'markers':[],'notes':[]}
        assert len(c.findall('v'))==int(meta.find(f'c[@n="{cn}"]/vs').text)
        for verse in c.findall('v'):
            vn=int(verse.attrib['n']);ch['verses'].append(vn)
            children=list(verse);j=0
            while j<len(children):
                el=children[j]
                if el.tag in ('k','q'):
                    # Group consecutive ketiv then qere, ending before a new k.
                    ks=[];qs=[];positions=[]
                    while j<len(children) and children[j].tag=='k':
                        ks.append(hebrew_text(children[j]));j+=1;stats['ketivWords']+=1
                    while j<len(children) and children[j].tag=='q':
                        qs.append(hebrew_text(children[j]));positions.append(j);j+=1
                    at=len(ch['tokens'])
                    variant={'verse':vn,'at':at,'written':ks,'read':qs}
                    ch['variants'].append(variant)
                    for text,pos in zip(qs,positions):
                        ch['tokens'].append({'text':text,'verse':vn,'sourceIndex':pos})
                        stats['hebrewReadWords']+=1
                    continue
                elif el.tag=='w':
                    text=hebrew_text(el)
                    assert re.search('[א-ת]',text), (cid,vn,text)
                    ch['tokens'].append({'text':text,'verse':vn,'sourceIndex':j})
                    stats['hebrewReadWords']+=1
                elif el.tag in ('pe','samekh','reversednun'):
                    ch['markers'].append({'verse':vn,'after':len(ch['tokens']),'text':{'pe':'פ','samekh':'ס','reversednun':'׆'}[el.tag],'kind':el.tag})
                    stats['hebrewMarkers']+=1
                elif el.tag=='x':
                    ch['notes'].append({'verse':vn,'after':len(ch['tokens']),'code':el.text or ''})
                else: raise ValueError(f'Unhandled Hebrew element {el.tag}')
                j+=1
            expected=[hebrew_text(e) for e in children if e.tag in ('w','q')]
            actual=[t['text'] for t in ch['tokens'] if t['verse']==vn]
            assert actual==expected, f'Reading mismatch {cid}:{vn}'
            # Retain nested annotations without inserting Latin note codes into Hebrew.
            for pos,el in enumerate(children):
                for note in el.iter('x'):
                    if note is not el: ch['notes'].append({'verse':vn,'sourceIndex':pos,'code':note.text or ''})
                for special in el.iter('s'):
                    ch['notes'].append({'verse':vn,'sourceIndex':pos,'specialLetter':hebrew_text(special),'attributes':special.attrib})
        data.append(ch)
    assert [c['number'] for c in data]==list(range(1,len(meta.findall('c'))+1))
    finish_book({'id':bid,'name':name,'nativeName':source_book.findtext('names/hebrewname'),'testament':'OT','language':'he','edition':version},data)

tar=tarfile.open(ROOT/'sources/sblgnt/source.tar.gz')
prefix=tar.getnames()[0]+'/'
commit=json.loads((ROOT/'sources/sblgnt/upstream-commit.json').read_text())['sha']
assert commit=='c4d241a9c1c479a55b989ba35a4976c1d0b8052c'
(LICENSES/'SBLGNT.txt').write_bytes(tar.extractfile(prefix+'LICENSE').read())
for bid,name,filename,count in NT:
    raw=tar.extractfile(prefix+'data/sblgnt/xml/'+filename+'.xml').read()
    source_hashes[filename+'.xml']=digest(raw)
    root=ET.fromstring(raw)
    data={};cn=vn=None;pending='';source_pos=0
    for el in root.iter():
        if el.tag in ('book','p','title'):continue
        if el.tag=='verse-number':
            assert not pending, 'Unconsumed prefix'
            cn,vn=map(int,el.attrib['id'].rsplit(' ',1)[1].split(':'))
            if cn not in data: data[cn]={'id':f'{bid}.{cn}','bookId':bid,'number':cn,'tokens':[],'verses':[],'variants':[],'markers':[],'notes':[]}
            assert vn not in data[cn]['verses'], f'Duplicate verse {name} {cn}:{vn}'
            data[cn]['verses'].append(vn);source_pos=0
        elif el.tag=='prefix': pending+=(el.text or '').strip()
        elif el.tag=='w':
            assert cn is not None
            token={'text':el.text or '', 'verse':vn, 'sourceIndex':source_pos}
            assert any(x.isalpha() for x in token['text'])
            if pending:token['prefix']=pending
            pending='';data[cn]['tokens'].append(token);source_pos+=1;stats['greekWords']+=1
        elif el.tag=='suffix':
            suffix=(el.text or '').strip()
            if suffix:data[cn]['tokens'][-1]['suffix']=suffix
        else: raise ValueError(f'Unhandled Greek element {el.tag}')
    assert list(data)==list(range(1,count+1)), name
    # Compare every source word and every non-whitespace punctuation character.
    source_words=[e.text for e in root.iter('w')]
    output_words=[t['text'] for c in data.values() for t in c['tokens']]
    assert source_words==output_words
    source_marks=''.join((e.text or '').strip() for e in root.iter() if e.tag in ('prefix','suffix'))
    output_marks=''.join(t.get('prefix','')+t.get('suffix','') for c in data.values() for t in c['tokens'])
    assert source_marks==output_marks, name
    finish_book({'id':bid,'name':name,'nativeName':root.findtext('title'),'testament':'NT','language':'grc','edition':'SBLGNT 1.2'},list(data.values()))

assert sum(b['chapters'] for b in books if b['testament']=='OT')==929
assert sum(b['chapters'] for b in books if b['testament']=='NT')==260
assert len(chapters)==1189 and len({c['id'] for c in chapters})==1189
manifest={'schemaVersion':1,'corpusId':'uxlc-2.5_sblgnt-1.2_tokens-v1','books':books,'chapters':chapters,
 'sources':{'hebrew':{'version':version,'archiveSha256':ziphash,'url':'https://www.tanach.us/Books/Tanach.xml.zip'},'greek':{'version':'SBLGNT 1.2','commit':commit,'url':'https://github.com/Faithlife/SBLGNT'}},'statistics':dict(stats)}
manifest['contentHash']=digest(''.join(digest((OUT/f'{b["id"]}.json').read_bytes()) for b in books).encode())
dump(OUT/'index.json',manifest)
dump(ROOT/'sources/source-lock.json',{'files':source_hashes,'contentHash':manifest['contentHash'],'sources':manifest['sources']})
print(json.dumps({'books':len(books),'chapters':len(chapters),'statistics':dict(stats),'contentHash':manifest['contentHash']},indent=2))
