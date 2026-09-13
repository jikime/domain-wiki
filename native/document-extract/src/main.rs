mod bitmap;
mod ebook;
fn main() {
    let Some(path) = std::env::args().nth(1) else {
        std::process::exit(2);
    };
    let extension = std::path::Path::new(&path)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ["bmp", "ico"].contains(&extension.as_str()) {
        match std::fs::read(&path)
            .ok()
            .and_then(|bytes| bitmap::to_png(&bytes).ok())
        {
            Some(png) => {
                use std::io::Write;
                if std::io::stdout().write_all(&png).is_err() {
                    std::process::exit(1);
                }
            }
            None => {
                eprintln!("Image extraction failed");
                std::process::exit(1);
            }
        }
        return;
    }
    if ![
        "doc", "docx", "docm", "ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "xls", "xlsx",
        "xlsm", "xlsb", "odt", "ods", "odp", "rtf", "epub", "mobi",
    ]
    .contains(&extension.as_str())
    {
        std::process::exit(2);
    }
    let result = if extension == "mobi" || extension == "epub" {
        ebook::extract_ebook_text(&path, &extension)
    } else {
        anydoc::to_markdown(&path).map_err(|e| e.to_string())
    };
    match result {
        Ok(markdown) if !markdown.trim().is_empty() => {
            println!("{}", serde_json::json!({"markdown": markdown}))
        }
        _ => {
            eprintln!("Document extraction failed");
            std::process::exit(1);
        }
    }
}
