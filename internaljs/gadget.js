
self.importScripts("../externaljs/capstone.min.js");

//Main Webworker handler
 onmessage = function (e) {
   gadgets = getAllGadgets(e.data);
   postMessage({status: "Found gadgets", gadgets: gadgets});
   close();
 }

function  getAllGadgets(segments) {
  var gadgets = [];

  for (si in segments) {
    var offByOne = parseInt(si)+1;
    postMessage({status: "Finding gadgets in segment " + offByOne + " of " + segments.length});
    var segment = segments[si];
    var localgadgets = getAllGadgetsInSection(segment);
    postMessage({status: "Found " +localgadgets.length+ " gadgets in segment"});
    gadgets = gadgets.concat(localgadgets);
  }

  //# Pass clean single instruction and unknown instructions
  postMessage({status: "Cleaning gadgets (removing blacklisted ones, false positives, redundant, etc.) from " + gadgets.length + " total gadgets."});
  gadgets = passCleanX86(gadgets)

  //# Delete duplicate gadgets
  postMessage({status: "Deleting duplicate gadgets from " + gadgets.length + " total gadgets." });
  gadgets = deleteDuplicateGadgets(gadgets)

  //# Sorted alphabetically
  postMessage({status: "Sorting " +gadgets.length+ " gadgets alphabetically"});
  gadgets = alphaSortgadgets(gadgets)

  postMessage({status: "Stripping " +gadgets.length+ " gadgets for rendering"});
  gadgets = stripGadgets(gadgets);

  return gadgets;
}



function getAllGadgetsInSection(section) {
 var gadgets = [];

 var ropGadgets = addROPGadgets(section);
 gadgets = gadgets.concat(ropGadgets);
 postMessage({status: "Found " + ropGadgets.length + " ROP gadgets."});
 var jopGadgets = addJOPGadgets(section);
 postMessage({status: "Found " + jopGadgets.length + " JOP gadgets."});
 gadgets = gadgets.concat(jopGadgets);
 var sysGadgets = addSYSGadgets(section);
 postMessage({status: "Found " + sysGadgets.length + " SYS gadgets."});
 gadgts = gadgets.concat(sysGadgets);
 return gadgets;
}


function addROPGadgets(section) {

       gadgets = [
                       [toMatcher("\xc3"), 1, 1],
                       [toMatcher("\xc2[\x00-\xff]{2}"), 3, 1],
                       [toMatcher("\xcb"), 1, 1],
                       [toMatcher("\xca[\x00-\xff]{2}"), 3, 1],
                       [toMatcher("\xf2\xc3"), 2, 1],
                       [toMatcher("\xf2\xc2[\x00-\xff]{2}"), 4, 1]
                  ];

       return gadgetsFinding(section, gadgets);
}

function addJOPGadgets(section) {
             gadgets = [
                                [toMatcher("\xff[\x20\x21\x22\x23\x26\x27]{1}"), 2, 1],
                                [toMatcher("\xff[\xe0\xe1\xe2\xe3\xe4\xe6\xe7]{1}"), 2, 1],
                                [toMatcher("\xff[\x10\x11\x12\x13\x16\x17]{1}"), 2, 1],
                                [toMatcher("\xff[\xd0\xd1\xd2\xd3\xd4\xd6\xd7]{1}"), 2, 1],
                                [toMatcher("\xf2\xff[\x20\x21\x22\x23\x26\x27]{1}"), 3, 1],
                                [toMatcher("\xf2\xff[\xe0\xe1\xe2\xe3\xe4\xe6\xe7]{1}"), 3, 1],
                                [toMatcher("\xf2\xff[\x10\x11\x12\x13\x16\x17]{1}"), 3, 1],
                                [toMatcher("\xf2\xff[\xd0\xd1\xd2\xd3\xd4\xd6\xd7]{1}"), 3, 1]
                       ];
             return gadgetsFinding(section, gadgets);
   }

 function addSYSGadgets( section) {
         gadgets = [
                            [toMatcher("\xcd\x80"), 2, 1],
                            [toMatcher("\x0f\x34"), 2, 1],
                            [toMatcher("\x0f\x05"), 2, 1],
                            [toMatcher("\x65\xff\x15\x10\x00\x00\x00"), 7, 1],
                            [toMatcher("\xcd\x80\xc3"), 3, 1],
                            [toMatcher("\x0f\x34\xc3"), 3, 1],
                            [toMatcher("\x0f\x05\xc3"), 3, 1],
                            [toMatcher("\x65\xff\x15\x10\x00\x00\x00\xc3"), 8, 1]
                   ];

         return gadgetsFinding(section, gadgets);
}

function passCleanX86(gadgets, multibr) {
     n = [];
     br = ["ret", "retf", "int", "sysenter", "jmp", "call", "syscall"];
     for (gi in gadgets) {
         var gadget = gadgets[gi];
         var gadgetstr = gadget["gadget"];
         var insts = gadgetstr.split(" ; ");
         if (insts.length == 1 && !inArray(br, insts[0].split(" ")[0])) {
             continue
         } if (!inArray(br, insts[insts.length-1].split(" ")[0])) {
             continue
         } if (checkInstructionBlackListedX86(insts)) {
             continue
         } if (!multibr && checkMultiBr(insts, br) > 1) {
             continue
         } if ((gadget["gadget"].match(/ret/g) || []).length > 1) {
             continue
         }
         n.push(gadget);
     }
     return n
 }

 function gadgetsFinding(section, gadgets, offset) {
     var offset = offset || 0;
     var C_OP    = 0;
     var C_SIZE  = 1;
     var C_ALIGN = 2;
     var PREV_BYTES = 9; //# Number of bytes prior to the gadget to store.
     var ret = [];
     var md = new cs.Capstone(cs.ARCH_X86, cs.MODE_64);

     var opcodesStr = encodeArray(section["opcodes"]);
     for (var gadi in gadgets) {
         var gad = gadgets[gadi];
         var oprg = new RegExp(gad[C_OP], "g");
         var opri = new RegExp(gad[C_OP], "i");
         var allRefRet = matchPositions(oprg, opcodesStr)
         for (refi in allRefRet) {
           var ref = allRefRet[refi];
           //ROPgadget's depth option goes here...
             for (var i = 0; i < 10; i++) {
                 if ((section["vaddr"]+ref-(i*gad[C_ALIGN])) % gad[C_ALIGN] == 0) {
                     var opcode = section["opcodes"].slice(ref-(i*gad[C_ALIGN]),ref+gad[C_SIZE]);
                     var decodes = [];
                     try {
                        decodes = md.disasm(opcode, section["vaddr"]+ref);
                      } catch (e) {
                        continue
                      }
                     var gadget = "";
                     var lastdecode;
                     for (var decodei in decodes) {
                       var decode = decodes[decodei];
                       gadget += (decode.mnemonic + " " + decode.op_str + " ; ").replace("  ", " ");
                       lastdecode = decode;
                     }
                     if (!lastdecode || !opri.exec(encodeArray(lastdecode.bytes))) {
                             continue;
                     }
                     if (gadget.length > 0) {
                         var gadget = gadget.slice(0,gadget.length-3);
                         var off = offset;
                         var vaddr = off+section["vaddr"]+ref-(i*gad[C_ALIGN]);
                         var prevBytesAddr = Math.max(section["vaddr"], vaddr - PREV_BYTES);
                         var prevBytes = section["opcodes"].slice(prevBytesAddr-section["vaddr"],vaddr-section["vaddr"]);
                         var newGad = {
                             "vaddr" :  vaddr,
                             "gadget" : gadget,
                             "decodes" : decodes,
                             "bytes": section["opcodes"].slice(ref-(i*gad[C_ALIGN]),ref+gad[C_SIZE]),
                             "prev": prevBytes
                           };
                         ret.push(newGad);
                     }
                   }
               }
         }
     }
     md.close();
     return ret;
}

function checkInstructionBlackListedX86(insts) {
    var bl = ["db", "int3"];
    for (insti in insts) {
      var inst = insts[insti];

        for (bi in bl) {
          var b = bl[bi];
            if (inst.split(" ")[0] == b) {
                return true;
            }
        }
    }
    return false;
  }

function checkMultiBr(insts, br) {
    var count = 0
    for (insti in insts) {
        var inst = insts[insti];
        if (inArray(br, inst.split()[0])) {
            count += 1
        }
    }
    return count;
}

function matchPositions(re, str) {
  var mps = [];
  while ((match = re.exec(str)) != null) {
    mps.push(match.index);
  }
  return mps;
}

function inArray(arr, elem) {
  for (ai in arr) {
    var ae = arr[ai];
    if (ae == elem) {
      return true
    }
  }
  return false
}

function toMatcher(str) {
  return str;
}

function encodeArray(uint8array) {
  var myString = "";
  for (var i=0; i<uint8array.length; i++) {
      myString += String.fromCharCode(uint8array[i])
  }
  return myString;
}


function deleteDuplicateGadgets(currentGadgets) {
    var gadgets_content_set = new Set();
    var unique_gadgets = [];

    for (gi in currentGadgets) {
        var gadget = currentGadgets[gi];
        var gad = gadget["gadget"]
        if (gadgets_content_set.has(gad)) {
            continue
        }
        gadgets_content_set.add(gad)
        unique_gadgets.push(gadget);
    }
    return unique_gadgets
}

function alphaSortgadgets(currentGadgets) {
    return currentGadgets;
}

function stripGadgets(gadgets) {
  var strippedGadgets = [];

  for (var gi in gadgets) {
    var gadget = gadgets[gi];
    var strippedGadget = {
      vaddr: gadget.vaddr.toString(16),
      gadget: gadget.gadget
    };
    strippedGadgets.push(strippedGadget);
  }

  return strippedGadgets;
}