# Third-party notices

This integration ports to JavaScript the logic of the following project: the
HTTP interface of the HDFury boxes (the board page `/ssi/brdinfo.ssi`, the
info page `/ssi/infopage.ssi`, the `/cmd?<name>=<value>` commands and the
form of their values, `insel` with its two outputs separated by `%20`), the
2-second wait after a command before the box is read again, and the tables of
the operation modes and of the inputs of each output (`src/hdfury/`). Nothing
of it is installed at runtime; its notice is reproduced below.

## hdfury 1.6.1

<https://github.com/glenndehaan/python-hdfury> (the library behind the Home
Assistant HDFury integration), version 1.6.1 of 2026-09-01. Its license file
is named `LICENCE`.

```
MIT License

Copyright (c) 2017 Glenn de Haan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant, HDFury integration

<https://github.com/home-assistant/core/tree/dev/homeassistant/components/hdfury>
(Apache License 2.0): only consulted, no code copied. Its use of the serial
number as the identity of a box, of the hostname for its name and model, the
list of the info page texts it shows, the features offered only when their
key is in the info page, and the example answers of its tests are reused as
facts.

## LM1LC3N7/gladys-jvc-projector

The structure of the app, the `/data` store, the command queue and budget,
and the handler wiring follow an integration of the same author, under the
Apache License 2.0 of this repository.
