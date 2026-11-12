Synthetic image fixtures created for MoarTube, with Sharp 0.35.4/libvips 8.18.6
used once as the comparison reference. Running tests does not require Sharp.

Source RGBA is 64x48 pixels. For each x/y: red is 240 when x<32, otherwise 20;
green is 80 when y<24, otherwise 210; blue is 30 when x<32, otherwise 200;
alpha is 0 when x<16, 128 when 16<=x<32, otherwise 255.

alpha.png preserves this RGBA. RGB source flattens against black. rgb.jpg uses
quality 95 and 4:4:4. p3.png uses the reference's built-in P3 ICC transform and
embedded profile. cmyk.jpg uses the default CMYK conversion, quality 100, 4:4:4
and no embedded ICC. The corresponding *-srgb.png files are the reference's
decoded sRGB normalization, without resizing. Tests attach the separately pinned
public-domain CMYK profile to cmyk.jpg in memory to exercise embedded ICC too.
