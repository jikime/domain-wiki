"""개발 표본의 OOXML 위치를 확인한다. 범용 Office 파서가 아니다."""
import json
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

target = Path("docs/evaluation/stage-02/fixtures")
ns = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
docx = []
with ZipFile(target / "conditions-table.docx") as archive:
    body = ET.fromstring(archive.read("word/document.xml")).find("w:body", ns)
    for index, item in enumerate(body, 1):
        if item.tag.endswith("}p"):
            docx.append({"locator": {"bodyElement": index, "kind": "paragraph"},
                         "text": "".join(item.itertext())})
        elif item.tag.endswith("}tbl"):
            for row, cells in enumerate(item.findall("w:tr", ns), 1):
                for col, cell in enumerate(cells.findall("w:tc", ns), 1):
                    docx.append({"locator": {"bodyElement": index, "kind": "cell", "row": row, "column": col},
                                 "text": "".join(cell.itertext())})
pptx = []
with ZipFile(target / "screen-notes.pptx") as archive:
    for part, kind in [("ppt/slides/slide1.xml", "shape"),
                       ("ppt/notesSlides/notesSlide1.xml", "speaker-note")]:
        root = ET.fromstring(archive.read(part))
        for shape in root.findall(".//p:sp", ns):
            props = shape.find("p:nvSpPr/p:cNvPr", ns)
            pptx.append({"locator": {"slide": 1, "kind": kind, "shapeId": props.attrib["id"], "part": part},
                         "text": "".join(node.text or "" for node in shape.findall(".//a:t", ns))})
print(json.dumps({"docx": docx, "pptx": pptx}, ensure_ascii=False))
