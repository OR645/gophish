/*
	landing_pages.js
	Handles the creation, editing, and deletion of landing pages
	Author: Jordan Wright <github.com/jordan-wright>
*/
var pages = []


// Save attempts to POST to /templates/
function save(idx) {
    var page = {}
    page.name = $("#name").val()
    editor = CKEDITOR.instances["html_editor"]
    page.html = editor.getData()
    page.capture_credentials = $("#capture_credentials_checkbox").prop("checked")
    page.capture_passwords = $("#capture_passwords_checkbox").prop("checked")
    page.redirect_url = $("#redirect_url_input").val()
    if (idx != -1) {
        page.id = pages[idx].id
        api.pageId.put(page)
            .success(function (data) {
                successFlash("Page edited successfully!")
                load()
                dismiss()
            })
    } else {
        // Submit the page
        api.pages.post(page)
            .success(function (data) {
                successFlash("Page added successfully!")
                load()
                dismiss()
            })
            .error(function (data) {
                modalError(data.responseJSON.message)
            })
    }
}

function dismiss() {
    $("#modal\\.flashes").empty()
    $("#name").val("")
    $("#html_editor").val("")
    $("#url").val("")
    $("#redirect_url_input").val("")
    $("#modal").find("input[type='checkbox']").prop("checked", false)
    $("#capture_passwords").hide()
    $("#redirect_url").hide()
    $("#modal").modal('hide')
}

var deletePage = function (idx) {
    Swal.fire({
        title: "Are you sure?",
        text: "This will delete the landing page. This can't be undone!",
        type: "warning",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Delete " + escapeHtml(pages[idx].name),
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        preConfirm: function () {
            return new Promise(function (resolve, reject) {
                api.pageId.delete(pages[idx].id)
                    .success(function (msg) {
                        resolve()
                    })
                    .error(function (data) {
                        reject(data.responseJSON.message)
                    })
            })
        }
    }).then(function (result) {
        if (result.value){
            Swal.fire(
                'Landing Page Deleted!',
                'This landing page has been deleted!',
                'success'
            );
        }
        $('button:contains("OK")').on('click', function () {
            location.reload()
        })
    })
}

// preview renders the selected landing page's HTML inside a sandboxed
// iframe so the user can see the rendered result without editing it.
function preview(idx) {
    var page = pages[idx]
    $("#previewModalLabel").text(page.name)
    var frame = document.getElementById("previewFrame")
    var html = page.html || "<div style='font-family:sans-serif;color:#888;padding:24px'>This landing page has no HTML content.</div>"
    frame.srcdoc = html
}

function importSite() {
    url = $("#url").val()
    if (!url) {
        modalError("No URL Specified!")
    } else {
        api.clone_site({
                url: url,
                include_resources: false
            })
            .success(function (data) {
                $("#html_editor").val(data.html)
                CKEDITOR.instances["html_editor"].setMode('wysiwyg')
                $("#importSiteModal").modal("hide")
            })
            .error(function (data) {
                modalError(data.responseJSON.message)
            })
    }
}

function edit(idx) {
    $("#modalSubmit").unbind('click').click(function () {
        save(idx)
    })
    $("#html_editor").ckeditor()
    setupAutocomplete(CKEDITOR.instances["html_editor"])
    var page = {}
    if (idx != -1) {
        $("#modalLabel").text("Edit Landing Page")
        page = pages[idx]
        $("#name").val(page.name)
        $("#html_editor").val(page.html)
        $("#capture_credentials_checkbox").prop("checked", page.capture_credentials)
        $("#capture_passwords_checkbox").prop("checked", page.capture_passwords)
        $("#redirect_url_input").val(page.redirect_url)
        if (page.capture_credentials) {
            $("#capture_passwords").show()
            $("#redirect_url").show()
        }
    } else {
        $("#modalLabel").text("New Landing Page")
    }
}

function copy(idx) {
    $("#modalSubmit").unbind('click').click(function () {
        save(-1)
    })
    $("#html_editor").ckeditor()
    var page = pages[idx]
    $("#name").val("Copy of " + page.name)
    $("#html_editor").val(page.html)
}

// renderCard builds a single landing-page card with a live HTML preview.
function renderCard(page, i) {
    var modified = moment(page.modified_date).format('MMM Do YYYY, h:mm a')
    var flags = ""
    if (page.capture_credentials) {
        flags += "<span class='tag' style='color:var(--c-clicked)'><i class='fa fa-mouse-pointer'></i>&nbsp;Capture data</span>"
    }
    if (page.capture_passwords) {
        flags += "<span class='tag' style='color:var(--c-submitted)'><i class='fa fa-lock'></i>&nbsp;Capture creds</span>"
    }
    if (page.redirect_url) {
        flags += "<span class='tag'><i class='fa fa-external-link'></i>&nbsp;Redirect</span>"
    }
    var card = $(
        "<div class='tcard' data-name='" + escapeHtml(page.name) + "'>" +
        "  <div class='thumb'>" +
        "    <div class='previewbar'><span class='d'></span><span class='d'></span><span class='d'></span><span class='u'>landing page</span></div>" +
        "    <div class='frame-wrap'></div>" +
        "    <div class='overlay'><span class='pill pill-active open-pill'><i class='fa fa-eye'></i>&nbsp;Preview</span></div>" +
        "  </div>" +
        "  <div class='tmeta'>" +
        "    <div class='tname'><b>" + escapeHtml(page.name) + "</b><span>" + modified + "</span></div>" +
        "    <div class='tactions'>" +
        "      <button class='icon-btn' title='Edit' data-toggle='modal' data-backdrop='static' data-target='#modal' onclick='edit(" + i + ")'><i class='fa fa-pencil'></i></button>" +
        "      <button class='icon-btn' title='Copy' data-toggle='modal' data-backdrop='static' data-target='#modal' onclick='copy(" + i + ")'><i class='fa fa-copy'></i></button>" +
        "      <button class='icon-btn' title='Delete' onclick='deletePage(" + i + ")'><i class='fa fa-trash-o'></i></button>" +
        "    </div>" +
        "  </div>" +
        (flags ? "  <div class='tflags'>" + flags + "</div>" : "") +
        "</div>"
    )
    if (page.html) {
        var frame = $("<iframe sandbox='' title='preview' scrolling='no'></iframe>")
        card.find(".frame-wrap").append(frame)
        frame[0].srcdoc = page.html
    } else {
        card.find(".frame-wrap").replaceWith("<div class='empty'>[ no HTML content ]</div>")
    }
    card.find(".overlay").attr({ "data-toggle": "modal", "data-backdrop": "static", "data-target": "#previewModal" })
        .on("click", function () { preview(i) })
    return card
}

function load() {
    /*
        load() - Loads the current pages using the API
    */
    $("#pagesGrid").hide().empty()
    $("#emptyMessage").hide()
    $("#loading").show()
    api.pages.get()
        .success(function (ps) {
            pages = ps
            $("#loading").hide()
            $("#pageCount").text("Landing Pages · " + pages.length)
            if (pages.length > 0) {
                var grid = $("#pagesGrid").show()
                $.each(pages, function (i, page) {
                    grid.append(renderCard(page, i))
                })
                $('[data-toggle="tooltip"]').tooltip()
            } else {
                $("#emptyMessage").show()
            }
        })
        .error(function () {
            $("#loading").hide()
            errorFlash("Error fetching pages")
        })
}

$(document).ready(function () {
    // Setup multiple modals
    // Code based on http://miles-by-motorcycle.com/static/bootstrap-modal/index.html
    $('.modal').on('hidden.bs.modal', function (event) {
        $(this).removeClass('fv-modal-stack');
        $('body').data('fv_open_modals', $('body').data('fv_open_modals') - 1);
    });
    $('.modal').on('shown.bs.modal', function (event) {
        // Keep track of the number of open modals
        if (typeof ($('body').data('fv_open_modals')) == 'undefined') {
            $('body').data('fv_open_modals', 0);
        }
        // if the z-index of this modal has been set, ignore.
        if ($(this).hasClass('fv-modal-stack')) {
            return;
        }
        $(this).addClass('fv-modal-stack');
        // Increment the number of open modals
        $('body').data('fv_open_modals', $('body').data('fv_open_modals') + 1);
        // Setup the appropriate z-index
        $(this).css('z-index', 1040 + (10 * $('body').data('fv_open_modals')));
        $('.modal-backdrop').not('.fv-modal-stack').css('z-index', 1039 + (10 * $('body').data('fv_open_modals')));
        $('.modal-backdrop').not('fv-modal-stack').addClass('fv-modal-stack');
    });
    $.fn.modal.Constructor.prototype.enforceFocus = function () {
        $(document)
            .off('focusin.bs.modal') // guard against infinite focus loop
            .on('focusin.bs.modal', $.proxy(function (e) {
                if (
                    this.$element[0] !== e.target && !this.$element.has(e.target).length
                    // CKEditor compatibility fix start.
                    &&
                    !$(e.target).closest('.cke_dialog, .cke').length
                    // CKEditor compatibility fix end.
                ) {
                    this.$element.trigger('focus');
                }
            }, this));
    };
    // Scrollbar fix - https://stackoverflow.com/questions/19305821/multiple-modals-overlay
    $(document).on('hidden.bs.modal', '.modal', function () {
        $('.modal:visible').length && $(document.body).addClass('modal-open');
    });
    $('#modal').on('hidden.bs.modal', function (event) {
        dismiss()
    });
    $("#capture_credentials_checkbox").change(function () {
        $("#capture_passwords").toggle()
        $("#redirect_url").toggle()
    })
    CKEDITOR.on('dialogDefinition', function (ev) {
        // Take the dialog name and its definition from the event data.
        var dialogName = ev.data.name;
        var dialogDefinition = ev.data.definition;

        // Check if the definition is from the dialog window you are interested in (the "Link" dialog window).
        if (dialogName == 'link') {
            dialogDefinition.minWidth = 500
            dialogDefinition.minHeight = 100

            // Remove the linkType field
            var infoTab = dialogDefinition.getContents('info');
            infoTab.get('linkType').hidden = true;
        }
    });

    load()
})
