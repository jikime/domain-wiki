"""직접 작성한 최소 OOXML 개발 표본. 외부 고객 자료를 포함하지 않는다."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

target = Path("docs/evaluation/stage-02/fixtures")
target.mkdir(parents=True, exist_ok=True)
rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
office_rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

def archive(name, root, main_type, main_path, files, overrides=""):
    with ZipFile(target / name, "w", ZIP_DEFLATED) as out:
        out.writestr("[Content_Types].xml", f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/{main_path}" ContentType="{main_type}"/>{overrides}</Types>')
        out.writestr("_rels/.rels", f'<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{office_rel}/officeDocument" Target="{main_path}"/></Relationships>')
        out.writestr(main_path, root)
        for path, content in files.items():
            out.writestr(path, content)

def para(text):
    return f'<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'

rows = []
for row in [["사업", "주기", "조건"], ["새봄시", "30초", "정상 통신"], ["겨울시", "10초", "별도 사업"]]:
    rows.append('<w:tr>' + ''.join(f'<w:tc><w:tcPr/><w:p><w:r><w:t>{cell}</w:t></w:r></w:p></w:tc>' for cell in row) + '</w:tr>')
document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + para("DOCX 개발 표본 — 실제 고객 지침이 아님") + para("통신 중단 시 최신 값으로 표시하면 안 된다.") + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' + ''.join(rows) + '</w:tbl>' + para("검토 중인 변경은 반영 완료가 아니다.") + '<w:sectPr/></w:body></w:document>'
archive("conditions-table.docx", document, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", "word/document.xml", {})

def shape(identifier, text):
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{identifier}" name="Text {identifier}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{escape(text)}</a:t></a:r></a:p></p:txBody></p:sp>'

slide_header = f'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="{office_rel}"'
slide = f'<p:sld {slide_header}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{shape(2,"PPTX 화면설계 개발 표본")}{shape(3,"화면: 마지막 수신 시각 표시")}{shape(4,"조건: 통신 중단 값을 최신 값으로 표시하면 안 된다.")}</p:spTree></p:cSld></p:sld>'
notes = f'<p:notes {slide_header}><p:cSld><p:spTree>{shape(5,"발표자 주석: 반영 완료가 아니라 검토 중이다.")}</p:spTree></p:cSld></p:notes>'
presentation = f'<p:presentation {slide_header}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>'
archive("screen-notes.pptx", presentation, "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", "ppt/presentation.xml", {
    "ppt/_rels/presentation.xml.rels": f'<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{office_rel}/slide" Target="slides/slide1.xml"/></Relationships>',
    "ppt/slides/slide1.xml": slide,
    "ppt/slides/_rels/slide1.xml.rels": f'<Relationships xmlns="{rel_ns}"><Relationship Id="rId2" Type="{office_rel}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    "ppt/notesSlides/notesSlide1.xml": notes,
}, '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>')
print("개발 DOCX·PPTX 표본 2개 생성 완료")
