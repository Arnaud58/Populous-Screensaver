cmake_minimum_required(VERSION 3.21)

project(populous-screensaver LANGUAGES CXX)

# This file is built from an assembled payload, not from the repository root:
#
#     python tools/build-targets.py qt-app
#     cmake -S build/qt-app -B build/qt-app-cmake
#     cmake --build build/qt-app-cmake --config Release
#
# The engine, the atlas and the manifest are copied in beside it and compiled
# into the executable through the generated resources.qrc, so the result does
# not depend on any file sitting next to it.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

# QuickControls2 is only used by the /c dialog, but it has to be linked so the
# module is resolvable at run time.
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2)

qt_standard_project_setup()

qt_add_executable(populous
    main.cpp
    resources.qrc
)

target_link_libraries(populous PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
)

# WIN32_EXECUTABLE keeps a console from appearing behind the screen saver.
set_target_properties(populous PROPERTIES
    WIN32_EXECUTABLE ON
    MACOSX_BUNDLE OFF
)

# A Windows screen saver is an ordinary executable with a different extension.
if(WIN32)
    set_target_properties(populous PROPERTIES SUFFIX ".scr")
endif()
