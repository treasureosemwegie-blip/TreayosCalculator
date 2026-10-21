param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root 'android\app\src\main\res'
$iconPath = Join-Path $root 'icons\icon-512.png'
$maskablePath = Join-Path $root 'icons\icon-512-maskable.png'
$foregroundPath = Join-Path $root 'icons\icon-foreground-432.png'

if (-not (Test-Path -LiteralPath $res)) {
  throw 'Android project not found. Run npx cap add android first.'
}

$densities = @(
  @{ Name = 'mdpi'; Icon = 48; Foreground = 108 },
  @{ Name = 'hdpi'; Icon = 72; Foreground = 162 },
  @{ Name = 'xhdpi'; Icon = 96; Foreground = 216 },
  @{ Name = 'xxhdpi'; Icon = 144; Foreground = 324 },
  @{ Name = 'xxxhdpi'; Icon = 192; Foreground = 432 }
)

function Save-ResizedPng {
  param(
    [string]$Source,
    [int]$Size,
    [string]$Destination,
    [switch]$Round,
    [switch]$Square
  )

  $image = [System.Drawing.Image]::FromFile($Source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        if ($Round) {
          $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
          try {
            $clip.AddEllipse(0, 0, $Size, $Size)
            $graphics.SetClip($clip)
            $graphics.DrawImage($image, 0, 0, $Size, $Size)
          } finally {
            $clip.Dispose()
          }
        } elseif ($Square) {
          $graphics.DrawImage($image, 0, 0, $Size, $Size)
        } else {
          $graphics.DrawImage($image, 0, 0, $Size, $Size)
        }
      } finally {
        $graphics.Dispose()
      }

      $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

foreach ($density in $densities) {
  $folder = Join-Path $res ('mipmap-' + $density.Name)
  New-Item -ItemType Directory -Force -Path $folder | Out-Null

  Save-ResizedPng -Source $maskablePath -Size $density.Icon -Destination (Join-Path $folder 'ic_launcher.png') -Square
  Save-ResizedPng -Source $maskablePath -Size $density.Icon -Destination (Join-Path $folder 'ic_launcher_round.png') -Round
  Save-ResizedPng -Source $foregroundPath -Size $density.Foreground -Destination (Join-Path $folder 'ic_launcher_foreground.png')
}

$splashFiles = Get-ChildItem -LiteralPath $res -Recurse -Filter 'splash.png'
$splashIcon = [System.Drawing.Image]::FromFile($iconPath)

try {
  foreach ($file in $splashFiles) {
    $size = [System.Drawing.Image]::FromFile($file.FullName)
    try {
      $width = $size.Width
      $height = $size.Height
    } finally {
      $size.Dispose()
    }

    $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $rect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
        $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
          $rect,
          [System.Drawing.Color]::FromArgb(17, 26, 51),
          [System.Drawing.Color]::FromArgb(7, 10, 18),
          45
        )
        try {
          $graphics.FillRectangle($gradient, $rect)
        } finally {
          $gradient.Dispose()
        }

        $purple = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 124, 92, 255))
        $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 76, 141, 255))
        try {
          $graphics.FillEllipse($purple, [int](-$width * 0.28), [int](-$height * 0.18), [int]($width * 0.75), [int]($width * 0.75))
          $graphics.FillEllipse($blue, [int]($width * 0.55), [int]($height * 0.68), [int]($width * 0.7), [int]($width * 0.7))
        } finally {
          $purple.Dispose()
          $blue.Dispose()
        }

        $iconSize = [int]([Math]::Min($width, $height) * 0.3)
        $x = [int](($width - $iconSize) / 2)
        $y = [int](($height - $iconSize) / 2)
        $graphics.DrawImage($splashIcon, $x, $y, $iconSize, $iconSize)
      } finally {
        $graphics.Dispose()
      }

      $bitmap.Save($file.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $splashIcon.Dispose()
}

Write-Host 'Android launcher icons and splash screens updated.'
