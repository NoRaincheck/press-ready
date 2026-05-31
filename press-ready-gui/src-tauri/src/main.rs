#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::process::Command;

use serde::Serialize;

const ICC_PROFILE: &[u8] = include_bytes!("../../assets/JapanColor2001Coated.icc");

const PDFX_DEF_TEMPLATE: &str = r#"systemdict /ProcessColorModel known {
  systemdict /ProcessColorModel get dup /DeviceGray ne exch /DeviceCMYK ne and
} {
  true
} ifelse
{ (ERROR: ProcessColorModel must be /DeviceGray or DeviceCMYK.)=
  /ProcessColorModel cvx /rangecheck signalerror
} if
/ICCProfile ({{{iccProfilePath}}}) def
[ /GTS_PDFXVersion (PDF/X-1:2001)
  /GTS_PDFXConformance (PDF/X-1a:2001)
  /Title ({{{title}}})
  /Trapped /False
  /DOCINFO pdfmark
currentdict /ICCProfile known {
  [/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
  [{icc_PDFX} <</N systemdict /ProcessColorModel get /DeviceGray eq {1} {4} ifelse >> /PUT pdfmark
  [{icc_PDFX} ICCProfile (r) file /PUT pdfmark
} if
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition (Commercial and specialty printing)
  /Info (test)
  /OutputConditionIdentifier (U001)
  /RegistryName (http://www.color.org)
  currentdict /ICCProfile known {
    /DestOutputProfile {icc_PDFX}
  } if
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFX} ]>> /PUT pdfmark"#;

#[derive(Serialize)]
struct DepStatus {
    ghostscript: bool,
    pdffonts: bool,
}

#[derive(Serialize)]
struct ConvertResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
fn check_dependencies() -> DepStatus {
    let gs = Command::new("gs")
        .arg("--version")
        .output()
        .ok()
        .map_or(false, |o| o.status.success());

    let pf = Command::new("which")
        .arg("pdffonts")
        .output()
        .ok()
        .map_or(false, |o| o.status.success());

    DepStatus {
        ghostscript: gs,
        pdffonts: pf,
    }
}

#[tauri::command]
fn run_pdffonts(file_path: String) -> Result<String, String> {
    let output = Command::new("pdffonts")
        .arg(&file_path)
        .output()
        .map_err(|e| format!("Failed to run pdffonts: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pdffonts exited with error: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn convert_pdf(
    input: String,
    output: String,
    grayscale: bool,
    enforce_outline: bool,
    boundary_boxes: bool,
) -> Result<ConvertResult, String> {
    let tmp = std::env::temp_dir();
    let id = format!(
        "pr{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    let icc_path = tmp.join(format!("{}.icc", id));
    let ps_path = tmp.join(format!("{}.ps", id));

    fs::write(&icc_path, ICC_PROFILE).map_err(|e| format!("write icc: {}", e))?;

    let ps_body = PDFX_DEF_TEMPLATE
        .replace("{{{iccProfilePath}}}", icc_path.to_str().unwrap())
        .replace("{{{title}}}", "Auto-generated PDF (press-ready)");
    fs::write(&ps_path, &ps_body).map_err(|e| format!("write ps: {}", e))?;

    let icc_str = icc_path.to_str().unwrap().to_string();
    let ps_str = ps_path.to_str().unwrap().to_string();

    let mut args: Vec<String> = vec![
        "-dPDFX".into(),
        "-dBATCH".into(),
        "-dNOPAUSE".into(),
        "-dNOOUTERSAVE".into(),
        "-sDEVICE=pdfwrite".into(),
        "-dPDFSTOPONERROR".into(),
        "-dShowAnnots=false".into(),
        "-dPDFSETTINGS=/prepress".into(),
        "-dPrinted".into(),
        "-r300".into(),
        "-dDownsampleColorImages=true".into(),
        "-dDownsampleGrayImages=true".into(),
        "-dDownsampleMonoImages=true".into(),
        "-dColorImageResolution=300".into(),
        "-dGrayImageResolution=300".into(),
        "-dMonoImageResolution=300".into(),
        format!("-sOutputFile={}", output),
        "-dNOSAFER".into(),
    ];

    if boundary_boxes {
        args.push("-dUseCropBox".into());
        args.push("-dUseTrimBox".into());
        args.push("-dUseBleedBox".into());
    }
    if enforce_outline {
        args.push("-dNoOutputFonts".into());
    }
    if grayscale {
        args.push("-sProcessColorModel=DeviceGray".into());
        args.push("-sColorConversionStrategy=Gray".into());
        args.push("-sColorConversionStrategyForImages=Gray".into());
    } else {
        args.push("-sProcessColorModel=DeviceCMYK".into());
        args.push("-sColorConversionStrategy=CMYK".into());
        args.push("-sColorConversionStrategyForImages=CMYK".into());
        args.push("-dOverrideICC".into());
        args.push(format!("-sOutputICCProfile={}", icc_str));
    }

    args.push(ps_str);
    args.push(input);

    let result = Command::new("gs")
        .args(&args)
        .output()
        .map_err(|e| format!("run gs: {}", e))?;

    let _ = fs::remove_file(&icc_path);
    let _ = fs::remove_file(&ps_path);

    Ok(ConvertResult {
        exit_code: result.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&result.stdout).to_string(),
        stderr: String::from_utf8_lossy(&result.stderr).to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_dependencies,
            run_pdffonts,
            convert_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
