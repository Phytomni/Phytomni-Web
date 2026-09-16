package document_format

import (
	"bytes"
	"compress/zlib"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/jung-kurt/gofpdf"
)

type contractEmphasis struct {
	Index  int    `json:"index"`
	Text   string `json:"text"`
	Bold   bool   `json:"bold,omitempty"`
	Italic bool   `json:"italic,omitempty"`
}
type contractLink struct {
	Index int    `json:"index"`
	Label string `json:"label"`
	Href  string `json:"href"`
}
type contractCitation struct {
	Before  string `json:"before"`
	Text    string `json:"text"`
	Indices []int  `json:"indices"`
	Active  bool   `json:"active"`
}
type contractScript struct {
	Before   string `json:"before"`
	Text     string `json:"text"`
	Vertical string `json:"vertical"`
}
type citedContract struct {
	Content    string          `json:"content"`
	References json.RawMessage `json:"references"`
	Expected   struct {
		Sentences []string           `json:"sentences"`
		Emphasis  []contractEmphasis `json:"emphasis"`
		Links     []contractLink     `json:"links"`
		Citations []contractCitation `json:"citations"`
		Scripts   []contractScript   `json:"scripts,omitempty"`
	} `json:"expected"`
}

const crossFormatUnicodeSource = "# Plant hormones\n\nGibberellin GA₂₀ and GA₁ act at 10⁻⁶ M. Water is H<sub>2</sub>O and iron is Fe<sup>3+</sup>. The *OsD18* gene remains italic [1]."

func TestCrossFormatUnicodeScientificScriptsKeepMarkdownSource(t *testing.T) {
	refs := json.RawMessage(`[{"title":"A plant study"}]`)
	answer, err := json.Marshal(citedEnvelope{crossFormatUnicodeSource, refs})
	if err != nil {
		t.Fatal(err)
	}
	scripts := []contractScript{
		{Before: "Gibberellin GA", Text: "20", Vertical: "subscript"},
		{Before: " and GA", Text: "1", Vertical: "subscript"},
		{Before: " act at 10", Text: "-6", Vertical: "superscript"},
		{Before: "Water is H", Text: "2", Vertical: "subscript"},
		{Before: "iron is Fe", Text: "3+", Vertical: "superscript"},
	}
	for _, tool := range []string{"KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		t.Run(tool, func(t *testing.T) {
			agent, err := NewAgentWithOptions(tool, AgentOptions{})
			if err != nil {
				t.Fatal(err)
			}
			markdown, _, err := agent.Download("Markdown", string(answer))
			if err != nil {
				t.Fatal(err)
			}
			body := string(markdown)
			if !strings.HasPrefix(body, crossFormatUnicodeSource+"\n\n## References\n\n") {
				t.Fatal("Markdown rewrote the Unicode source")
			}
			for _, keep := range []string{"GA₂₀", "GA₁", "10⁻⁶", "H<sub>2</sub>O", "Fe<sup>3+</sup>", "*OsD18*"} {
				if !strings.Contains(body, keep) {
					t.Fatalf("Markdown lost source %q", keep)
				}
			}
			for _, sub := range []string{"GA20", "10-6"} {
				if strings.Contains(body, sub) {
					t.Fatalf("Markdown substituted ASCII %q", sub)
				}
			}
			word, _, err := agent.Download("Word", string(answer))
			if err != nil {
				t.Fatal(err)
			}
			assertWordUnicodeScriptsNormalized(t, word, scripts)
		})
	}
}

func assertWordUnicodeScriptsNormalized(t *testing.T, body []byte, scripts []contractScript) {
	t.Helper()
	stylesXML := wordPackagePart(t, body, "word/styles.xml")
	if !strings.Contains(stylesXML, "Times New Roman") {
		t.Fatal("DOCX styles omitted Times New Roman")
	}
	xmlBody := wordDocumentXML(t, body)
	if !strings.Contains(xmlBody, "vertAlign") {
		t.Fatal("DOCX omitted w:vertAlign")
	}
	for _, keep := range []string{"GA₂₀", "GA₁", "10⁻⁶"} {
		if strings.Contains(xmlBody, keep) {
			t.Fatalf("DOCX kept Unicode %q instead of native vertical runs", keep)
		}
	}
	var styles struct {
		Rows []struct {
			ID    string `xml:"styleId,attr"`
			Fonts struct {
				Ascii string `xml:"ascii,attr"`
			} `xml:"rPr>rFonts"`
		} `xml:"style"`
	}
	if err := xml.Unmarshal([]byte(stylesXML), &styles); err != nil {
		t.Fatal(err)
	}
	styleFonts := map[string]string{}
	for _, style := range styles.Rows {
		styleFonts[style.ID] = style.Fonts.Ascii
	}
	decoder := xml.NewDecoder(strings.NewReader(xmlBody))
	paragraphStyle := ""
	var visible strings.Builder
	matched := 0
	gene := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		if start.Name.Local == "p" {
			paragraphStyle = ""
		}
		if start.Name.Local == "pPr" {
			var properties struct {
				Style struct {
					Val string `xml:"val,attr"`
				} `xml:"pStyle"`
			}
			if err := decoder.DecodeElement(&properties, &start); err != nil {
				t.Fatal(err)
			}
			paragraphStyle = properties.Style.Val
		}
		if start.Name.Local != "r" {
			continue
		}
		var run contractWordRun
		if err := decoder.DecodeElement(&run, &start); err != nil {
			t.Fatal(err)
		}
		value := strings.Join(run.Text, "")
		if value == "" {
			continue
		}
		font := styleFonts[paragraphStyle]
		if run.Properties.Fonts != nil && run.Properties.Fonts.Ascii != "" {
			font = run.Properties.Fonts.Ascii
		}
		if font != "Times New Roman" {
			t.Fatalf("DOCX run %q omitted Times New Roman", value)
		}
		before := visible.String()
		if value == "OsD18" {
			italic := run.Properties.Italic != nil && run.Properties.Italic.Val != "false" && run.Properties.Italic.Val != "0"
			if !italic {
				t.Fatal("italic gene lost")
			}
			gene = true
		}
		for _, script := range scripts {
			if script.Before != "" && strings.HasSuffix(before, script.Before) && value == script.Text {
				if run.Properties.Vertical == nil || run.Properties.Vertical.Val != script.Vertical {
					t.Fatalf("DOCX ordinary script %q lost native w:vertAlign=%s", script.Before, script.Vertical)
				}
				matched++
			}
		}
		visible.WriteString(value)
	}
	if matched != len(scripts) {
		t.Fatalf("DOCX ordinary script count: got %d want %d in %q", matched, len(scripts), visible.String())
	}
	if !gene {
		t.Fatal("italic gene run missing")
	}
}

func TestCrossFormatOrdinaryScriptsAreNotCitationMarkers(t *testing.T) {
	data, err := os.ReadFile("testdata/cited-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture citedContract
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.Content += "\n\nScientific upper<sup>2</sup>, lower<sub>2</sub>, then explicit [2]."
	fixture.Expected.Scripts = []contractScript{
		{Before: "Scientific upper", Text: "2", Vertical: "superscript"},
		{Before: ", lower", Text: "2", Vertical: "subscript"},
	}
	fixture.Expected.Citations = append(fixture.Expected.Citations, contractCitation{Before: "then explicit ", Text: "2", Indices: []int{2}, Active: true})
	answer, err := json.Marshal(citedEnvelope{fixture.Content, fixture.References})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		t.Run(tool, func(t *testing.T) {
			agent, err := NewAgentWithOptions(tool, AgentOptions{FontDir: requiredAcademicFontDir(t)})
			if err != nil {
				t.Fatal(err)
			}
			for _, format := range []string{"Word", "PDF", "Markdown"} {
				t.Run(format, func(t *testing.T) {
					body, _, err := agent.Download(format, string(answer))
					if err != nil {
						t.Fatal(err)
					}
					switch format {
					case "Word":
						checkContractWord(t, body, fixture)
					case "PDF":
						checkContractPDF(t, body, fixture)
					case "Markdown":
						checkContractMarkdown(t, string(body), fixture)
					}
				})
			}
		})
	}
}

func TestCrossFormatReviewedContract(t *testing.T) {
	data, err := os.ReadFile("testdata/cited-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture citedContract
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	answer, err := json.Marshal(citedEnvelope{fixture.Content, fixture.References})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		t.Run(tool, func(t *testing.T) {
			for _, format := range []string{"Markdown", "Word", "PDF"} {
				t.Run(format, func(t *testing.T) {
					opts := AgentOptions{}
					if format == "PDF" {
						opts.FontDir = requiredAcademicFontDir(t)
					}
					agent, err := NewAgentWithOptions(tool, opts)
					if err != nil {
						t.Fatal(err)
					}
					body, _, err := agent.Download(format, string(answer))
					if err != nil {
						t.Fatal(err)
					}
					switch format {
					case "Markdown":
						checkContractMarkdown(t, string(body), fixture)
					case "Word":
						checkContractWord(t, body, fixture)
					case "PDF":
						checkContractPDF(t, body, fixture)
					}
				})
			}
		})
	}
	again, err := os.ReadFile("testdata/cited-contract.json")
	if err != nil || !bytes.Equal(data, again) {
		t.Fatal("dispatcher rewrote fixture")
	}
}

func checkContractMarkdown(t *testing.T, body string, f citedContract) {
	t.Helper()
	if !strings.HasPrefix(body, f.Content+"\n\n## References\n\n") {
		t.Fatal("source body or terminal bibliography ownership drift")
	}
	bibliography := strings.TrimPrefix(body, f.Content+"\n\n## References\n\n")
	var sentences []string
	var links []contractLink
	var emphasis []contractEmphasis
	index := 0
	for _, line := range strings.Split(bibliography, "\n") {
		if m := regexp.MustCompile(`^(\d+)\. (.*)$`).FindStringSubmatch(line); m != nil {
			index, _ = strconv.Atoi(m[1])
			plain := strings.ReplaceAll(m[2], "*", "")
			plain = regexp.MustCompile(`\\(.)`).ReplaceAllString(plain, "$1")
			sentences = append(sentences, plain)
			for _, em := range regexp.MustCompile(`\*\*([^*]+)\*\*|\*([^*]+)\*`).FindAllStringSubmatch(m[2], -1) {
				value := em[1]
				bold := value != ""
				if !bold {
					value = em[2]
				}
				emphasis = append(emphasis, contractEmphasis{index, value, bold, !bold})
			}
		}
		for _, m := range regexp.MustCompile(`\[([^]]+)\]\(([^)]+)\)`).FindAllStringSubmatch(line, -1) {
			links = append(links, contractLink{index, m[1], strings.TrimSuffix(strings.TrimPrefix(m[2], "<"), ">")})
		}
	}
	if !reflect.DeepEqual(sentences, f.Expected.Sentences) || !reflect.DeepEqual(links, f.Expected.Links) || !reflect.DeepEqual(emphasis, f.Expected.Emphasis) {
		t.Fatalf("Markdown oracle mismatch: %v %v %v", sentences, links, emphasis)
	}
}

type contractWordRun struct {
	Properties struct {
		Bold *struct {
			Val string `xml:"val,attr"`
		} `xml:"b"`
		Italic *struct {
			Val string `xml:"val,attr"`
		} `xml:"i"`
		Vertical *struct {
			Val string `xml:"val,attr"`
		} `xml:"vertAlign"`
		Size *struct {
			Val string `xml:"val,attr"`
		} `xml:"sz"`
		Fonts *struct {
			Ascii string `xml:"ascii,attr"`
		} `xml:"rFonts"`
	} `xml:"rPr"`
	Text []string `xml:"t"`
}

func checkContractWord(t *testing.T, body []byte, f citedContract) {
	t.Helper()
	if !strings.Contains(wordPackagePart(t, body, "word/styles.xml"), "Times New Roman") {
		t.Fatal("DOCX styles omitted Times New Roman")
	}
	var styles struct {
		Rows []struct {
			ID   string `xml:"styleId,attr"`
			Size struct {
				Val string `xml:"val,attr"`
			} `xml:"rPr>sz"`
		} `xml:"style"`
	}
	if err := xml.Unmarshal([]byte(wordPackagePart(t, body, "word/styles.xml")), &styles); err != nil {
		t.Fatal(err)
	}
	styleSizes := map[string]string{}
	for _, style := range styles.Rows {
		styleSizes[style.ID] = style.Size.Val
	}
	paragraphStyle := ""
	var relationships struct {
		Rows []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
			Mode   string `xml:"TargetMode,attr"`
		} `xml:"Relationship"`
	}
	if err := xml.Unmarshal([]byte(wordPackagePart(t, body, "word/_rels/document.xml.rels")), &relationships); err != nil {
		t.Fatal(err)
	}
	targets := map[string]string{}
	for _, r := range relationships.Rows {
		if r.Mode == "External" {
			targets[r.ID] = r.Target
		}
	}
	decoder := xml.NewDecoder(strings.NewReader(wordDocumentXML(t, body)))
	var sentences []string
	var emphasis []contractEmphasis
	var links []contractLink
	var citations []string
	var bodyText strings.Builder
	scripts := 0
	bodyFaces := map[string][2]bool{}
	index := 0
	referenceParagraph := false
	var sentence strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if end, ok := token.(xml.EndElement); ok && end.Name.Local == "p" {
			if referenceParagraph {
				sentences = append(sentences, sentence.String())
				sentence.Reset()
			}
			referenceParagraph = false
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		if start.Name.Local == "p" {
			paragraphStyle = ""
		}
		if start.Name.Local == "pPr" {
			var properties struct {
				Style struct {
					Val string `xml:"val,attr"`
				} `xml:"pStyle"`
			}
			if err := decoder.DecodeElement(&properties, &start); err != nil {
				t.Fatal(err)
			}
			paragraphStyle = properties.Style.Val
		}
		if start.Name.Local == "hyperlink" {
			id := ""
			for _, a := range start.Attr {
				if a.Name.Local == "id" {
					id = a.Value
				}
			}
			var link struct {
				Runs []contractWordRun `xml:"r"`
			}
			if err := decoder.DecodeElement(&link, &start); err != nil {
				t.Fatal(err)
			}
			label := ""
			for _, run := range link.Runs {
				label += strings.Join(run.Text, "")
			}
			if href, ok := targets[id]; ok {
				links = append(links, contractLink{index, label, href})
			}
		}
		if start.Name.Local != "r" {
			continue
		}
		var run contractWordRun
		if err := decoder.DecodeElement(&run, &start); err != nil {
			t.Fatal(err)
		}
		value := strings.Join(run.Text, "")
		if value == "bold" || value == "italic" || value == "combined" {
			bodyFaces[value] = [2]bool{run.Properties.Bold != nil && run.Properties.Bold.Val != "false" && run.Properties.Bold.Val != "0", run.Properties.Italic != nil && run.Properties.Italic.Val != "false" && run.Properties.Italic.Val != "0"}
		}
		if value == fmt.Sprintf("%d.", index+1) {
			index++
			referenceParagraph = true
			continue
		}
		if referenceParagraph {
			sentence.WriteString(value)
			bold := run.Properties.Bold != nil && run.Properties.Bold.Val != "false" && run.Properties.Bold.Val != "0"
			italic := run.Properties.Italic != nil && run.Properties.Italic.Val != "false" && run.Properties.Italic.Val != "0"
			if bold || italic {
				emphasis = append(emphasis, contractEmphasis{index, value, bold, italic})
			}
		}
		if index == 0 {
			before := bodyText.String()
			for _, mark := range f.Expected.Citations {
				if mark.Before != "" && strings.HasSuffix(before, mark.Before) && value == mark.Text {
					if run.Properties.Vertical == nil || run.Properties.Vertical.Val != "superscript" || run.Properties.Size == nil || run.Properties.Size.Val != "24" {
						t.Fatalf("DOCX explicit citation %q lost its 12 pt native superscript", mark.Before)
					}
					citations = append(citations, value)
				}
			}
			for _, script := range f.Expected.Scripts {
				if script.Before != "" && strings.HasSuffix(before, script.Before) && value == script.Text {
					// Ordinary scripts inherit the paragraph role unless explicitly
					// overridden; native Word scaling must not be applied twice.
					size := styleSizes[paragraphStyle]
					if run.Properties.Size != nil {
						size = run.Properties.Size.Val
					}
					if run.Properties.Vertical == nil || run.Properties.Vertical.Val != script.Vertical || size != "24" {
						t.Fatalf("DOCX ordinary script %q lost its base size or native vertical position", script.Before)
					}
					scripts++
				}
			}
			bodyText.WriteString(value)
		}
	}
	if scripts != len(f.Expected.Scripts) {
		t.Fatalf("DOCX ordinary script count: got %d want %d", scripts, len(f.Expected.Scripts))
	}
	var marks []string
	if !reflect.DeepEqual(bodyFaces, map[string][2]bool{"bold": {true, false}, "italic": {false, true}, "combined": {true, true}}) {
		t.Fatalf("DOCX actual body face properties: %v", bodyFaces)
	}
	for _, mark := range f.Expected.Citations {
		marks = append(marks, mark.Text)
	}
	if !reflect.DeepEqual(sentences, f.Expected.Sentences) || !reflect.DeepEqual(emphasis, f.Expected.Emphasis) || !reflect.DeepEqual(links, f.Expected.Links) || !reflect.DeepEqual(citations, marks) {
		t.Fatalf("DOCX oracle mismatch sentences=%v emphasis=%v links=%v citations=%v", sentences, emphasis, links, citations)
	}
}

type contractPDFText struct {
	text, font, page string
	size, x, y       float64
}

// This narrow inspector reads only this writer's Flate text streams and font resources.
func contractPDFPaint(t *testing.T, data []byte) []contractPDFText {
	t.Helper()
	objectPattern := regexp.MustCompile(`(?s)(\d+) 0 obj\s*(.*?)endobj`)
	objectMatches := objectPattern.FindAllSubmatch(data, -1)
	objects := map[string]string{}
	fonts := map[string]string{}
	pageByStream := map[string]string{}
	for _, m := range objectMatches {
		if n := regexp.MustCompile(`/BaseFont /([^\s]+)`).FindSubmatch(m[2]); n != nil {
			objects[string(m[1])] = string(n[1])
		}
		if regexp.MustCompile(`/Type /Page(?:\s|/)`).Match(m[2]) {
			if contents := regexp.MustCompile(`/Contents (\d+) 0 R`).FindSubmatch(m[2]); contents != nil {
				pageByStream[string(contents[1])] = string(m[1])
			}
		}
	}
	for _, m := range regexp.MustCompile(`/([^ /\s]+) (\d+) 0 R`).FindAllSubmatch(data, -1) {
		if font, ok := objects[string(m[2])]; ok {
			fonts[string(m[1])] = font
		}
	}
	var out []contractPDFText
	pattern := regexp.MustCompile(`(?s)/([^ /]+) ([0-9.]+) Tf|BT ([0-9.-]+) ([0-9.-]+) Td \(((?:\\.|[^\\)])*)\) Tj`)
	streamPattern := regexp.MustCompile(`(?s)stream\r?\n(.*?)\r?\nendstream`)
	for _, object := range objectMatches {
		m := streamPattern.FindSubmatch(object[2])
		if m == nil {
			continue
		}
		r, err := zlib.NewReader(bytes.NewReader(m[1]))
		if err != nil {
			continue
		}
		stream, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		font := ""
		size := 0.0
		for _, m := range pattern.FindAllStringSubmatch(string(stream), -1) {
			if m[1] != "" {
				font = fonts[m[1]]
				size, _ = strconv.ParseFloat(m[2], 64)
				continue
			}
			raw := []byte(m[5])
			var unescaped []byte
			for i := 0; i < len(raw); i++ {
				if raw[i] == '\\' && i+1 < len(raw) {
					i++
					switch raw[i] {
					case 'n':
						unescaped = append(unescaped, '\n')
					case 'r':
						unescaped = append(unescaped, '\r')
					default:
						unescaped = append(unescaped, raw[i])
					}
				} else {
					unescaped = append(unescaped, raw[i])
				}
			}
			value := string(unescaped)
			if strings.HasPrefix(font, "utf8") {
				var codes []uint16
				for i := 0; i+1 < len(unescaped); i += 2 {
					codes = append(codes, uint16(unescaped[i])<<8|uint16(unescaped[i+1]))
				}
				value = string(utf16.Decode(codes))
			}
			x, _ := strconv.ParseFloat(m[3], 64)
			y, _ := strconv.ParseFloat(m[4], 64)
			out = append(out, contractPDFText{text: value, font: font, page: pageByStream[string(object[1])], size: size, x: x, y: y})
		}
	}
	if len(out) == 0 {
		t.Fatal("no actual PDF text")
	}
	return out
}

func contractPDFMarkerWidthPoints(t *testing.T, text string) float64 {
	t.Helper()
	metrics, err := gofpdf.TtfParse(filepath.Join(requiredAcademicFontDir(t), "times.ttf"))
	if err != nil || metrics.UnitsPerEm == 0 {
		t.Fatalf("read independent Times New Roman metrics: %v", err)
	}
	width := 0.0
	for _, character := range text {
		glyph, ok := metrics.Chars[uint16(character)]
		if !ok || int(glyph) >= len(metrics.Widths) {
			t.Fatalf("marker glyph %q absent from independent font metrics", character)
		}
		width += float64(metrics.Widths[glyph]) / float64(metrics.UnitsPerEm) * 8
	}
	return width
}

func contractPDFDestinationMatches(reference contractPDFText, targetPage string, destinationY float64) bool {
	return reference.page != "" && targetPage == reference.page && math.Abs(destinationY-reference.y-12) < .02
}

func TestContractPDFDestinationPageOracleRejectsMatchingYOnWrongPage(t *testing.T) {
	reference := contractPDFText{text: "1.", page: "17", y: 100}
	if contractPDFDestinationMatches(reference, "18", 112) {
		t.Fatal("matching destination y accepted the wrong target page")
	}
	if !contractPDFDestinationMatches(reference, "17", 112) {
		t.Fatal("matching target page and y were rejected")
	}
}

func checkContractPDF(t *testing.T, data []byte, f citedContract) {
	t.Helper()
	paint := contractPDFPaint(t, data)
	bodyFaces := map[string]string{}
	for _, p := range paint {
		if p.text == "bold" || p.text == "italic" || p.text == "combined" {
			bodyFaces[p.text] = p.font
		}
	}
	if !reflect.DeepEqual(bodyFaces, map[string]string{"bold": "utf8academic-tnrB", "italic": "utf8academic-tnrI", "combined": "utf8academic-tnrBI"}) {
		t.Fatalf("PDF actual body faces: %v", bodyFaces)
	}
	var full strings.Builder
	var fontBytes []string
	var marks []contractPDFText
	scripts := 0
	for i, p := range paint {
		// Source-context expectations distinguish typography from citations even
		// when both paint as the same 8 pt raised digit. Font size is a checked
		// property, never the classifier.
		before := full.String()
		for _, mark := range f.Expected.Citations {
			if mark.Before != "" && strings.HasSuffix(before, mark.Before) && p.text == mark.Text {
				if p.size != 8 {
					t.Fatalf("PDF explicit citation %q lost its 8 pt size", mark.Before)
				}
				marks = append(marks, p)
			}
		}
		for _, script := range f.Expected.Scripts {
			if script.Before != "" && strings.HasSuffix(before, script.Before) && p.text == script.Text {
				rise := 3.0
				if script.Vertical == "subscript" {
					rise = -3
				}
				if i == 0 || p.page != paint[i-1].page || p.size != 8 || math.Abs(p.y-paint[i-1].y-rise) > .02 {
					t.Fatalf("PDF ordinary script %q lost its 8 pt size or signed rise", script.Before)
				}
				scripts++
			}
		}
		full.WriteString(p.text)
		for range []byte(p.text) {
			fontBytes = append(fontBytes, p.font)
		}
	}
	if scripts != len(f.Expected.Scripts) {
		t.Fatalf("PDF ordinary script count: got %d want %d", scripts, len(f.Expected.Scripts))
	}
	text := full.String()
	offset := strings.Index(text, "References")
	if offset < 0 {
		t.Fatal("PDF bibliography missing")
	}
	for i, sentence := range f.Expected.Sentences {
		start := strings.Index(text[offset:], sentence)
		if start < 0 {
			t.Fatalf("PDF sentence %d absent", i+1)
		}
		start += offset
		want := make([]string, len(sentence))
		for j := range want {
			want[j] = "utf8academic-tnr"
		}
		for _, em := range f.Expected.Emphasis {
			if em.Index == i+1 {
				pos := strings.Index(sentence, em.Text)
				face := "utf8academic-tnr"
				if em.Bold {
					face += "B"
				}
				if em.Italic {
					face += "I"
				}
				for j := pos; j < pos+len(em.Text); j++ {
					want[j] = face
				}
			}
		}
		if !reflect.DeepEqual(fontBytes[start:start+len(sentence)], want) {
			t.Fatalf("PDF sentence %d real face mismatch", i+1)
		}
		offset = start + len(sentence)
	}
	if len(marks) != len(f.Expected.Citations) {
		t.Fatalf("PDF citation count %d", len(marks))
	}
	for i, m := range marks {
		if m.text != f.Expected.Citations[i].Text {
			t.Fatalf("PDF citation %d: %q", i, m.text)
		}
	}
	var rows []contractPDFText
	for _, p := range paint {
		if regexp.MustCompile(`^\d+\.$`).MatchString(p.text) {
			rows = append(rows, p)
		}
	}
	if len(rows) != len(f.Expected.Sentences) {
		t.Fatal("PDF bibliography positions shifted")
	}
	var links []contractLink
	for _, m := range regexp.MustCompile(`/Subtype /Link /Rect \[([0-9. -]+)\] /Border \[0 0 0\] /A <</S /URI /URI \(([^)]+)\)`).FindAllSubmatch(data, -1) {
		coords := strings.Fields(string(m[1]))
		x, _ := strconv.ParseFloat(coords[0], 64)
		top, _ := strconv.ParseFloat(coords[1], 64)
		bottom, _ := strconv.ParseFloat(coords[3], 64)
		label := ""
		index := 0
		for _, p := range paint {
			if math.Abs(p.x-x) < .02 && p.y < top && p.y > bottom {
				label += p.text
				for i, row := range rows {
					if p.y < row.y {
						index = i + 1
					}
				}
			}
		}
		href := string(m[2])
		if len(links) > 0 && links[len(links)-1].Href == href && links[len(links)-1].Index == index {
			links[len(links)-1].Label += label
		} else {
			links = append(links, contractLink{index, label, href})
		}
	}
	if !reflect.DeepEqual(links, f.Expected.Links) {
		t.Fatalf("PDF actual linked labels/destinations: %v", links)
	}
	annotations := regexp.MustCompile(`/Subtype /Link /Rect \[([0-9. -]+)\] /Border \[0 0 0\] /Dest \[(\d+) 0 R /XYZ 0 ([0-9.-]+) null\]`).FindAllSubmatch(data, -1)
	active := 0
	for i, mark := range f.Expected.Citations {
		if !mark.Active {
			continue
		}
		if active >= len(annotations) {
			t.Fatal("PDF active citation link absent")
		}
		ann := annotations[active]
		active++
		coords := strings.Fields(string(ann[1]))
		x, _ := strconv.ParseFloat(coords[0], 64)
		y, _ := strconv.ParseFloat(coords[1], 64)
		right, _ := strconv.ParseFloat(coords[2], 64)
		bottom, _ := strconv.ParseFloat(coords[3], 64)
		expectedWidth := contractPDFMarkerWidthPoints(t, mark.Text)
		if len(coords) != 4 || math.Abs(x-marks[i].x) > .02 || math.Abs(y-marks[i].y-8) > .02 ||
			math.Abs(right-marks[i].x-expectedWidth) > .02 || math.Abs(bottom-marks[i].y+1.6) > .02 {
			t.Fatal("PDF link not attached to complete citation marker")
		}
		dest, _ := strconv.ParseFloat(string(ann[3]), 64)
		targetPage := string(ann[2])
		found := false
		for _, p := range paint {
			if p.text == fmt.Sprintf("%d.", mark.Indices[0]) && contractPDFDestinationMatches(p, targetPage, dest) {
				found = true
			}
		}
		if !found {
			t.Fatalf("PDF target does not match reference %d", mark.Indices[0])
		}
	}
	if active != len(annotations) {
		t.Fatal("inactive/excluded marker acquired a PDF destination")
	}
	for _, face := range []string{"academic-tnr", "academic-tnrB", "academic-tnrI", "academic-tnrBI"} {
		if !bytes.Contains(data, []byte("/BaseFont /utf8"+face+"\n")) {
			t.Fatalf("missing embedded face %s", face)
		}
	}
	if bytes.Count(data, []byte("/FontFile2")) != 4 {
		t.Fatal("PDF did not embed all genuine faces")
	}
}
