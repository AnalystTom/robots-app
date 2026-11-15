package com.robots.pdfview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A PDF drawn with the system PdfRenderer; Android's WebView cannot show one. */
class RobotsPdfViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RobotsPdfView")

    View(RobotsPdfView::class) {
      Events("onLoadError")
      Prop("uri") { view: RobotsPdfView, uri: String -> view.load(uri) }
      OnViewDestroys { view: RobotsPdfView -> view.release() }
    }
  }
}
