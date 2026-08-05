// Export a reproducible static-analysis snapshot from Ghidra.
// @category Populous

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.ReferenceManager;

public class ExportPopulousAnalysis extends GhidraScript {
    private PrintWriter writer(File file) throws Exception {
        return new PrintWriter(new OutputStreamWriter(
            new FileOutputStream(file), StandardCharsets.UTF_8));
    }

    private String clean(Object value) {
        if (value == null) {
            return "";
        }
        return value.toString()
            .replace("\\", "\\\\")
            .replace("\t", "\\t")
            .replace("\r", "\\r")
            .replace("\n", "\\n");
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) {
            throw new IllegalArgumentException(
                "Usage: ExportPopulousAnalysis.java <output-directory>");
        }

        File outputDirectory = new File(args[0]);
        if (!outputDirectory.isDirectory() && !outputDirectory.mkdirs()) {
            throw new IllegalStateException(
                "Cannot create output directory: " + outputDirectory);
        }

        FunctionIterator countIterator =
            currentProgram.getFunctionManager().getFunctions(true);
        int internalCount = 0;
        while (countIterator.hasNext()) {
            countIterator.next();
            internalCount++;
        }
        FunctionIterator externalCountIterator =
            currentProgram.getFunctionManager().getExternalFunctions();
        int externalCount = 0;
        while (externalCountIterator.hasNext()) {
            externalCountIterator.next();
            externalCount++;
        }

        try (PrintWriter out = writer(new File(outputDirectory, "summary.txt"))) {
            out.println("name=" + currentProgram.getName());
            out.println("format=" + currentProgram.getExecutableFormat());
            out.println("md5=" + currentProgram.getExecutableMD5());
            out.println("sha256=" + currentProgram.getExecutableSHA256());
            out.println("language=" + currentProgram.getLanguageID());
            out.println("compiler=" +
                currentProgram.getCompilerSpec().getCompilerSpecID());
            out.println("imageBase=" + currentProgram.getImageBase());
            out.println("minAddress=" + currentProgram.getMinAddress());
            out.println("maxAddress=" + currentProgram.getMaxAddress());
            out.println("internalFunctions=" + internalCount);
            out.println("externalFunctions=" + externalCount);
        }

        ReferenceManager references = currentProgram.getReferenceManager();
        try (PrintWriter out = writer(new File(outputDirectory, "functions.tsv"))) {
            out.println("address\tname\tsize\tcallingConvention\tthunk	referencesTo");
            FunctionIterator functions =
                currentProgram.getFunctionManager().getFunctions(true);
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                if (function.isExternal()) {
                    continue;
                }
                int referenceCount = 0;
                ReferenceIterator iterator =
                    references.getReferencesTo(function.getEntryPoint());
                while (iterator.hasNext()) {
                    iterator.next();
                    referenceCount++;
                }
                out.printf("%s\t%s\t%d\t%s\t%s\t%d%n",
                    function.getEntryPoint(), clean(function.getName()),
                    function.getBody().getNumAddresses(),
                    clean(function.getCallingConventionName()),
                    function.isThunk(), referenceCount);
            }
        }

        try (PrintWriter out = writer(new File(outputDirectory, "imports.tsv"))) {
            out.println("library\tname\taddress\tcaller\tcallSite");
            FunctionIterator functions =
                currentProgram.getFunctionManager().getExternalFunctions();
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                ReferenceIterator iterator =
                    references.getReferencesTo(function.getEntryPoint());
                if (!iterator.hasNext()) {
                    out.printf("%s\t%s\t%s\t\t%n",
                        clean(function.getParentNamespace().getName()),
                        clean(function.getName()), function.getEntryPoint());
                    continue;
                }
                while (iterator.hasNext()) {
                    Reference reference = iterator.next();
                    Function caller = currentProgram.getFunctionManager()
                        .getFunctionContaining(reference.getFromAddress());
                    out.printf("%s\t%s\t%s\t%s\t%s%n",
                        clean(function.getParentNamespace().getName()),
                        clean(function.getName()), function.getEntryPoint(),
                        caller == null ? "" : clean(caller.getName()),
                        reference.getFromAddress());
                }
            }
        }

        Listing listing = currentProgram.getListing();
        try (PrintWriter out = writer(new File(outputDirectory, "strings.tsv"))) {
            out.println("address\tvalue\treferenceCount");
            for (Data data : listing.getDefinedData(true)) {
                Object value = data.getValue();
                if (!(value instanceof String)) {
                    continue;
                }
                int referenceCount = 0;
                ReferenceIterator iterator =
                    references.getReferencesTo(data.getAddress());
                while (iterator.hasNext()) {
                    iterator.next();
                    referenceCount++;
                }
                out.printf("%s\t%s\t%d%n", data.getAddress(), clean(value),
                    referenceCount);
            }
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.toggleCCode(true);
        decompiler.toggleSyntaxTree(true);
        if (!decompiler.openProgram(currentProgram)) {
            throw new IllegalStateException("Decompiler could not open program");
        }

        int decompiled = 0;
        int failed = 0;
        try (PrintWriter out = writer(new File(outputDirectory, "decompiled.c"))) {
            FunctionIterator functions =
                currentProgram.getFunctionManager().getFunctions(true);
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                if (function.isExternal()) {
                    continue;
                }
                out.printf("\n/* ===== %s %s (%d bytes) ===== */\n",
                    function.getEntryPoint(), function.getName(),
                    function.getBody().getNumAddresses());
                DecompileResults result =
                    decompiler.decompileFunction(function, 60, monitor);
                if (result.decompileCompleted() &&
                    result.getDecompiledFunction() != null) {
                    out.println(result.getDecompiledFunction().getC());
                    decompiled++;
                }
                else {
                    out.println("/* DECOMPILATION FAILED: " +
                        clean(result.getErrorMessage()) + " */");
                    failed++;
                }
            }
        }
        decompiler.dispose();

        println("Exported " + decompiled + " functions; " + failed +
            " decompilation failures to " + outputDirectory);
    }
}
