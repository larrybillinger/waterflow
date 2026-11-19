"""Static UI contract checks; not a substitute for browser/WebGL testing."""
from html.parser import HTMLParser
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent / "web"


class UIParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.scripts = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "script" and attrs.get("src"):
            self.scripts.append(attrs["src"])


def test_every_movie_and_app_dom_reference_is_present():
    parser = UIParser()
    parser.feed((ROOT / "index.html").read_text())
    assert len(set(parser.ids)) == len(parser.ids), "Duplicate HTML ID"
    for file in ("app.js", "movie.js"):
        source = (ROOT / file).read_text()
        for item in re.findall(r"""\$\(['"]([^'"]+)['"]\)""", source):
            assert item in parser.ids, f"{file} refers to missing element #{item}"


def test_movie_load_order_and_marker_asset():
    parser = UIParser()
    parser.feed((ROOT / "index.html").read_text())
    assert parser.scripts.index("/static/movie.js") < parser.scripts.index("/static/app.js")
    assert (ROOT / "simulation-worker.js").read_text().find("importScripts('flow-tracker.js')") >= 0
    assert (ROOT / "flow-tracker.js").exists()
    raft = ET.parse(ROOT / "raft.svg").getroot()
    assert raft.tag.endswith("svg")
