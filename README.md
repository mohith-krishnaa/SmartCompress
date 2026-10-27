# SmartCompress

A free, mobile-friendly browser utility for compressing images and working with PDFs.

**Live app:** https://smartcompress.floot.app

## Features

### Images
- Compress JPG, PNG, and WebP images
- Batch-process images and download a ZIP
- Choose output format and maximum dimensions
- Set a target output size and compare measured output size

### PDFs
- Optimize/compress PDFs
- Merge PDFs
- Extract selected pages
- Rotate pages
- Add page numbers or a text watermark
- Split selected pages into a new PDF
- Delete or reorder pages
- Convert images to PDF and PDF pages to PNG images

The app's supported operations are implemented in the browser using JavaScript libraries. Results depend on the input file and operation; a target size is not guaranteed.

## Technology

- React and TypeScript
- pdf-lib, jsPDF, PDF.js
- JSZip
- Lucide icons
- Floot hosting/build environment

## Development

This repository is being populated from the hosted Floot project. The hosted project uses Floot's component/runtime conventions, so a standalone local development workflow and exact generated configuration need to be verified before local setup instructions can be guaranteed.

## Privacy

File operations are intended to run in the browser for the tools listed above. Avoid using sensitive documents until you have reviewed the implementation and confirmed your own privacy requirements. Third-party font assets may be requested by the interface.

## License

MIT. See [LICENSE](LICENSE).
