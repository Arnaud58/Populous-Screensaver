cmake_minimum_required(VERSION 3.21)

# Written into the payload by tools/build-targets.py, from the same metadata
# the Plasma plugin ships. Included before project() because that is where the
# version has to be known.
include(${CMAKE_CURRENT_LIST_DIR}/version.cmake)

project(populous-screensaver VERSION ${POPULOUS_VERSION} LANGUAGES CXX)

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

# The version resource carries the name Windows shows in the screen-saver
# dialog. It is only meaningful on Windows, and only compilable there.
if(WIN32)
    configure_file(populous.rc.in populous.rc @ONLY)
    set(POPULOUS_VERSION_RESOURCE "${CMAKE_CURRENT_BINARY_DIR}/populous.rc")
endif()

qt_add_executable(populous
    main.cpp
    resources.qrc
    ${POPULOUS_VERSION_RESOURCE}
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
#
# The file name matters beyond tidiness: the screen-saver dialog labels an
# entry with the file name minus its extension. Measured on Windows 11 — a
# FileDescription of "Populous Screen Saver" still showed up as "populous"
# until the file itself was renamed.
if(WIN32)
    set_target_properties(populous PROPERTIES
        OUTPUT_NAME "Populous Screen Saver"
        SUFFIX ".scr"
    )
endif()

# Deployment is its own target so an ordinary build stays fast. It produces a
# self-contained directory: the executable, Qt's DLLs and QML modules, and the
# installer beside them. That directory is the release artefact.
if(WIN32)
    set(POPULOUS_DEPLOY_DIR "${CMAKE_BINARY_DIR}/deploy")

    # windeployqt is called directly rather than through
    # qt_generate_deploy_qml_app_script: that helper deploys the application's
    # own QML modules, and this application has none — its QML is resources.
    add_custom_target(deploy
        COMMAND ${CMAKE_COMMAND} -E rm -rf "${POPULOUS_DEPLOY_DIR}"
        COMMAND ${CMAKE_COMMAND} -E make_directory "${POPULOUS_DEPLOY_DIR}"
        COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:populous>" "${POPULOUS_DEPLOY_DIR}/"
        # --qmldir is not optional. The QML lives in the compiled resources, so
        # windeployqt cannot scan it from disk; without this it ships no QML
        # module at all and the binary exits 1 as soon as it loads main.qml.
        # --no-compiler-runtime drops the 25 MB vc_redist.x64.exe windeployqt
        # otherwise copies in. It is an installer, not a dependency: nothing
        # here runs it, so it would only inflate the download. The Visual C++
        # 2015-2022 redistributable has to be present on the machine instead.
        COMMAND Qt6::windeployqt
                --no-translations
                --no-compiler-runtime
                --qmldir "${CMAKE_CURRENT_SOURCE_DIR}/ui"
                "${POPULOUS_DEPLOY_DIR}/$<TARGET_FILE_NAME:populous>"
        COMMAND ${CMAKE_COMMAND} -E copy
                "${CMAKE_CURRENT_SOURCE_DIR}/install-windows.ps1"
                "${POPULOUS_DEPLOY_DIR}/"
        DEPENDS populous
        COMMENT "Deploying to ${POPULOUS_DEPLOY_DIR}"
        VERBATIM
    )

    # The release asset: the deployed directory, zipped. Nothing else is
    # needed to install — the archive contains its own installer.
    set(POPULOUS_ARCHIVE
        "${CMAKE_BINARY_DIR}/populous-screensaver-${PROJECT_VERSION}-windows-x64.zip")

    add_custom_target(package
        COMMAND ${CMAKE_COMMAND} -E rm -f "${POPULOUS_ARCHIVE}"
        COMMAND ${CMAKE_COMMAND} -E tar cf "${POPULOUS_ARCHIVE}" --format=zip .
        WORKING_DIRECTORY "${POPULOUS_DEPLOY_DIR}"
        DEPENDS deploy
        COMMENT "Packaging ${POPULOUS_ARCHIVE}"
        VERBATIM
    )
endif()
