use image::{ImageFormat, ImageReader, Limits};
use std::io::Cursor;

// Match the application's pixel and allocation limits before decoding BMP/ICO.
pub fn to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(reader.format(), Some(ImageFormat::Bmp | ImageFormat::Ico)) {
        return Err("Unsupported bitmap".into());
    }
    let (width, height) = reader.into_dimensions().map_err(|e| e.to_string())?;
    if u64::from(width) * u64::from(height) > 64_000_000 {
        return Err("Image pixel limit".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|e| e.to_string())?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bmp_and_ico_keep_pixels() {
        let input = image::RgbaImage::from_pixel(12, 8, image::Rgba([120, 70, 30, 255]));
        for format in [ImageFormat::Bmp, ImageFormat::Ico] {
            let mut bytes = Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(input.clone())
                .write_to(&mut bytes, format)
                .unwrap();
            let png = to_png(bytes.get_ref()).unwrap();
            assert_eq!(image::load_from_memory(&png).unwrap().to_rgba8(), input);
        }
    }
    #[test]
    fn invalid_or_oversized_bitmap_is_rejected() {
        assert!(to_png(b"invalid").is_err());
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::new(2, 2))
            .write_to(&mut bytes, ImageFormat::Bmp)
            .unwrap();
        let mut input = bytes.into_inner();
        input[18..22].copy_from_slice(&100_000_i32.to_le_bytes());
        input[22..26].copy_from_slice(&100_000_i32.to_le_bytes());
        assert!(to_png(&input).is_err());
    }
}
