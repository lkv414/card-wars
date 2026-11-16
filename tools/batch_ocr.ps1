param(
    [Parameter(Mandatory=$true)]
    [string]$PdfStem,
    [Parameter(Mandatory=$true)]
    [string]$OutFile,
    [Parameter(Mandatory=$false)]
    [string]$Lang = "ru"
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}[0]

function Await($WinRtTask, $ResultType) {
    $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
    $netTask.Wait()
    return $netTask.Result
}

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$langObj = [Windows.Globalization.Language]::new($Lang)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
if ($null -eq $engine) {
    Write-Error "OCR Engine could not be created for language $Lang"
    exit 1
}

$images = Get-ChildItem "pdf/temp" -Filter "$PdfStem`_p*.png" | Sort-Object { [int]($_.BaseName -replace '^.*_p', '') }

if ($images.Count -eq 0) {
    Write-Error "No images found in pdf/temp for pattern $PdfStem`_p*.png"
    exit 1
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# $PdfStem")
[void]$sb.AppendLine("Количество страниц: $($images.Count)`n")

foreach ($img in $images) {
    $pNum = [int]($img.BaseName -replace '^.*_p', '')
    Write-Host "  OCRing page $pNum ($($img.Name))..."
    
    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($img.FullName)
    $file = Await $fileOp ([Windows.Storage.StorageFile])

    $streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
    $stream = Await $streamOp ([Windows.Storage.Streams.IRandomAccessStream])

    $decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoder = Await $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

    $bitmapOp = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Await $bitmapOp ([Windows.Graphics.Imaging.SoftwareBitmap])

    $ocrOp = $engine.RecognizeAsync($bitmap)
    $result = Await $ocrOp ([Windows.Media.Ocr.OcrResult])

    [void]$sb.AppendLine("=== СТРАНИЦА $pNum ===")
    if ($result.Text -and $result.Text.Trim().Length -gt 0) {
        [void]$sb.AppendLine($result.Text.Trim())
    } else {
        [void]$sb.AppendLine("[Пустая страница или текст не распознан]")
    }
    [void]$sb.AppendLine("")
}

$outPath = [System.IO.Path]::GetFullPath($OutFile)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "Saved $OutFile ($($sb.Length) chars)"
