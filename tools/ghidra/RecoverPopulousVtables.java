// Recover function boundaries referenced only by the original C++ vtables.
// @category Populous

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.SourceType;

public class RecoverPopulousVtables extends GhidraScript {
    private static final long[][] TABLES = {
        {0x00421260L, 5}, {0x004212d8L, 5}, {0x00421388L, 5},
        {0x00421410L, 4}, {0x00421440L, 4}, {0x00421458L, 4},
        {0x00421480L, 4}, {0x00421490L, 4}, {0x004214c0L, 4},
        {0x004214d0L, 4}, {0x004214e8L, 4}, {0x004214f8L, 4},
        {0x00421510L, 4}, {0x00421520L, 4}, {0x00421530L, 4},
        {0x00421550L, 4},
    };

    @Override
    public void run() throws Exception {
        Memory memory = currentProgram.getMemory();
        int recovered = 0;
        for (long[] table : TABLES) {
            Address tableAddress = toAddr(table[0]);
            String tableName = String.format("vtable_%08x", table[0]);
            if (getSymbolAt(tableAddress) == null) {
                createLabel(tableAddress, tableName, true, SourceType.USER_DEFINED);
            }
            for (int slot = 0; slot < table[1]; slot++) {
                Address entry = tableAddress.add(slot * 4L);
                long targetValue = Integer.toUnsignedLong(memory.getInt(entry));
                Address target = toAddr(targetValue);
                if (!memory.contains(target) || !memory.getBlock(target).isExecute()) {
                    printerr(String.format("Invalid vtable target %s -> %s", entry, target));
                    continue;
                }
                Function function = getFunctionAt(target);
                if (function == null) {
                    function = createFunction(target, String.format("vfunc_%08x", targetValue));
                    if (function != null) {
                        recovered++;
                    }
                }
                createLabel(entry, tableName + "_slot_" + slot, true, SourceType.USER_DEFINED);
            }
        }
        println("Recovered " + recovered + " vtable function boundaries");
    }
}
