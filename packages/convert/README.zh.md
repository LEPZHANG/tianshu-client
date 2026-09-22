# convert/ — 文档转换能力家族

[English](README.md) | 中文

该家族把文件从一种文档格式转换为另一种，也把结构化内容直接写成这样一份文件：其中包含一个在已注册转换器之间规划路由的 seam、转换器提供方本身，以及两个面向模型的工具。

| 包 | 职责 | ctx key |
|---|---|---|
| [`document-convert/`](document-convert/README.md) | 定义提供方注册、路由规划、保真度与共享错误 | `ctx.documentConvert` |
| [`document-convert-libreoffice/`](document-convert-libreoffice/README.md) | 通过 LibreOffice headless 转换文档族、电子表格族与演示文稿族 | 注册到 `ctx.documentConvert` |
| [`document-convert-pandoc/`](document-convert-pandoc/README.md) | 在重新编码文件格式会丢失结构的方向上，借助 pandoc 的文档模型与 HTML、纯文本互转 | 注册到 `ctx.documentConvert` |
| [`document-convert-poppler/`](document-convert-poppler/README.md) | 通过 `pdftotext` 与 `pdftohtml` 提取 PDF 文本，使 PDF 可以作为转换源 | 注册到 `ctx.documentConvert` |
| [`tool-document-convert/`](tool-document-convert/README.md) | 以 `convert_document` 向模型公开转换能力 | 注册到 `ctx.tools` |
| [`tool-official-document/`](tool-official-document/README.md) | 以 `write_official_document` 按 GB/T 9704—2012 排版内容，自行写出 OpenDocument 文件，其余格式则经由 seam 抵达 | 注册到 `ctx.tools` |

seam 之所以规划多于一步的路由，是因为大多数跨族转换只能以这种方式成立：没有任何转换器能把 PDF 变成电子表格，但 `pdf → txt → xlsx` 可以。每条路由都声明自己保留的是源文档还是仅其文本，方案则上报各步骤中最差的那个判定，转换因此绝不会声称做到了超出实际的事。

二进制程序缺失的提供方会报告自身不可用，seam 则绕开它规划路由；因此同时挂载两个提供方的组合，会降级到宿主实际拥有的那些转换器。
